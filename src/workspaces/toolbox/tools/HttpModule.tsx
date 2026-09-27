import { useState, useEffect, useMemo } from 'react'
import type { ApiAssertion, ApiEnvironment, HttpRequest, RequestCollection } from '../../../types/toolbox'
import { HTTP_METHODS } from '../../../shared/constants'
import { electronAPI } from '../utils/electron'
import { interpolateRequest, runAssertions, type AssertionResult } from '../utils/env-interpolate'

/** 附录 F F.1：api 存储结构（集合 + 环境变量），替代旧 'requests' 键的写死 default 集合 */
interface ApiStore {
  collections: RequestCollection[]
  environments: ApiEnvironment[]
}

const API_STORE_KEY = 'api'
const LEGACY_REQUESTS_KEY = 'requests'

function genId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2)
}

export function HttpModule() {
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([])
  const [body, setBody] = useState('')
  const [response, setResponse] = useState('')
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)

  // 附录 F F.1：集合 + 环境
  const [collections, setCollections] = useState<RequestCollection[]>([])
  const [environments, setEnvironments] = useState<ApiEnvironment[]>([])
  const [activeCollectionId, setActiveCollectionId] = useState('')
  const [requestTab, setRequestTab] = useState<'request' | 'env' | 'assert'>('request')
  const [assertions, setAssertions] = useState<ApiAssertion[]>([])
  const [assertResults, setAssertResults] = useState<AssertionResult[] | null>(null)
  const [missingVars, setMissingVars] = useState<string[]>([])

  useEffect(() => {
    ;(async () => {
      // 迁移：旧 'requests' 键（写死 default 集合）→ 新 'api' 键
      let store = (await electronAPI.loadData(API_STORE_KEY)) as ApiStore | null
      if (!store || !Array.isArray(store.collections) || store.collections.length === 0) {
        const legacy = (await electronAPI.loadData(LEGACY_REQUESTS_KEY)) as
          | { collections?: RequestCollection[] }
          | null
        const legacyReqs = legacy?.collections?.flatMap((c) => c.requests ?? []) ?? []
        store = {
          collections: [{ id: 'default', name: '默认集合', requests: legacyReqs }],
          environments: store?.environments ?? [],
        }
      }
      setCollections(store.collections)
      setEnvironments(store.environments ?? [])
      setActiveCollectionId(store.collections[0]?.id ?? '')
    })()
  }, [])

  const activeEnv = useMemo(() => environments.find((e) => e.active) ?? null, [environments])
  const activeCollection = useMemo(
    () => collections.find((c) => c.id === activeCollectionId) ?? collections[0],
    [collections, activeCollectionId],
  )
  const history = activeCollection?.requests ?? []

  const persist = async (nextCollections: RequestCollection[], nextEnvs: ApiEnvironment[]) => {
    setCollections(nextCollections)
    setEnvironments(nextEnvs)
    await electronAPI.saveData(API_STORE_KEY, { collections: nextCollections, environments: nextEnvs })
  }

  const updateActiveCollection = (fn: (c: RequestCollection) => RequestCollection) => {
    if (!activeCollection) return
    persist(
      collections.map((c) => (c.id === activeCollection.id ? fn(c) : c)),
      environments,
    )
  }

  const addHeader = () => setHeaders([...headers, { key: '', value: '' }])

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...headers]
    newHeaders[index][field] = value
    setHeaders(newHeaders)
  }

  const removeHeader = (index: number) => setHeaders(headers.filter((_, i) => i !== index))

  /** 环境单激活切换 */
  const activateEnv = (id: string) => {
    persist(collections, environments.map((e) => ({ ...e, active: e.id === id })))
  }

  const addEnv = () => {
    const env: ApiEnvironment = { id: genId(), name: `环境 ${environments.length + 1}`, variables: {}, active: false }
    persist(collections, [...environments, env])
  }

  const updateEnvVar = (envId: string, key: string, value: string) => {
    const next = environments.map((e) =>
      e.id === envId ? { ...e, variables: { ...e.variables, [key]: value } } : e,
    )
    void persist(collections, next)
  }

  const removeEnvVar = (envId: string, key: string) => {
    const next = environments.map((e) => {
      if (e.id !== envId) return e
      const vars = { ...e.variables }
      delete vars[key]
      return { ...e, variables: vars }
    })
    void persist(collections, next)
  }

  const sendRequest = async () => {
    if (!url) return
    setLoading(true)
    setAssertResults(null)
    setMissingVars([])

    const headersObj: Record<string, string> = {}
    headers.forEach((h) => {
      if (h.key) headersObj[h.key] = h.value
    })

    // 附录 F F.1：发送前按激活环境插值（缺失变量高亮但不阻断）
    const vars = activeEnv?.variables ?? {}
    const filled = interpolateRequest(url, headersObj, body, vars)
    setMissingVars(filled.missing)

    try {
      // 附录 F F.2：请求经主进程发出（绕 CORS），二进制响应 base64 回传
      const res = await electronAPI.httpRequest({
        url: filled.url,
        method,
        headers: filled.headers,
        body: filled.body,
      })

      if (!res.success) {
        setResponse(`请求失败: ${res.error ?? '未知错误'}`)
        setStatusCode(null)
        setDuration(res.durationMs)
        return
      }

      const took = res.durationMs
      // 二进制响应：正文区展示占位说明（原始 base64 太大且不可读）
      const displayBody = res.bodyIsBase64
        ? `[二进制响应 ${res.headers['content-type'] ?? 'application/octet-stream'}，base64 ${res.body.length} 字符]\n（可在浏览器打开或另存查看）`
        : res.body

      setResponse(displayBody)
      setStatusCode(res.status)
      setDuration(took)

      // 断言校验
      const results = runAssertions(assertions, {
        status: res.status ?? 0,
        headers: res.headers,
        body: res.bodyIsBase64 ? '' : res.body,
        timeMs: took,
      })
      if (assertions.length > 0) setAssertResults(results)

      const request: HttpRequest = {
        id: genId(),
        method,
        url: filled.url,
        headers: filled.headers,
        body: filled.body,
        response: displayBody,
        statusCode: res.status ?? undefined,
        duration: took,
        createdAt: Date.now(),
        collectionId: activeCollection?.id,
        environmentId: activeEnv?.id,
        assertions,
      }

      // 归入当前集合（附录 F F.1：不再写死 default）
      updateActiveCollection((c) => ({ ...c, requests: [request, ...c.requests].slice(0, 50) }))
    } catch (e) {
      setResponse(`请求失败: ${(e as Error).message}`)
      setStatusCode(null)
      setDuration(null)
    } finally {
      setLoading(false)
    }
  }

  const addAssertion = () => {
    setAssertions([
      ...assertions,
      { id: genId(), type: 'status', op: 'eq', expected: '200' },
    ])
  }

  const updateAssertion = (id: string, patch: Partial<ApiAssertion>) => {
    setAssertions(assertions.map((a) => (a.id === id ? { ...a, ...patch } : a)))
  }

  const removeAssertion = (id: string) => setAssertions(assertions.filter((a) => a.id !== id))

  const resultById = useMemo(() => {
    const m = new Map<string, AssertionResult>()
    assertResults?.forEach((r) => m.set(r.id, r))
    return m
  }, [assertResults])

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>接口调试</h3>
        <div className="api-toolbar">
          <select
            value={activeCollection?.id ?? ''}
            onChange={(e) => setActiveCollectionId(e.target.value)}
            title="集合"
          >
            {collections.map((c) => (
              <option key={c.id} value={c.id}>
                📁 {c.name}
              </option>
            ))}
          </select>
          <select
            value={activeEnv?.id ?? ''}
            onChange={(e) => activateEnv(e.target.value)}
            title="环境（发送时插值 {{var}}）"
          >
            <option value="">无环境</option>
            {environments.map((env) => (
              <option key={env.id} value={env.id}>
                {env.name}
              </option>
            ))}
          </select>
          <button className="btn-secondary" onClick={addEnv} title="新建环境">
            +环境
          </button>
        </div>
      </div>
      <div className="module-body">
        <div className="http-request">
          <div className="url-bar">
            <select value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
              {HTTP_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://api.example.com/users（支持 {{host}} 插值）"
            />
            <button onClick={sendRequest} disabled={!url || loading}>
              {loading ? '发送中...' : '发送'}
            </button>
          </div>

          {missingVars.length > 0 && (
            <div className="api-missing-warn">
              未定义变量：{missingVars.map((v) => `{{${v}}}`).join('、')}（已在环境中定义则检查拼写）
            </div>
          )}

          <div className="api-tabs">
            <button
              className={`api-tab${requestTab === 'request' ? ' active' : ''}`}
              onClick={() => setRequestTab('request')}
            >
              请求
            </button>
            <button
              className={`api-tab${requestTab === 'env' ? ' active' : ''}`}
              onClick={() => setRequestTab('env')}
            >
              环境变量{activeEnv ? ` · ${activeEnv.name}` : ''}
            </button>
            <button
              className={`api-tab${requestTab === 'assert' ? ' active' : ''}`}
              onClick={() => setRequestTab('assert')}
            >
              断言{assertions.length > 0 ? ` · ${assertions.length}` : ''}
            </button>
          </div>

          {requestTab === 'request' && (
            <div className="tab-content">
              <div className="section-title">Headers</div>
              {headers.map((h, i) => (
                <div key={i} className="header-row">
                  <input
                    type="text"
                    value={h.key}
                    onChange={(e) => updateHeader(i, 'key', e.target.value)}
                    placeholder="Key"
                  />
                  <input
                    type="text"
                    value={h.value}
                    onChange={(e) => updateHeader(i, 'value', e.target.value)}
                    placeholder="Value"
                  />
                  <button onClick={() => removeHeader(i)} className="btn-danger">×</button>
                </div>
              ))}
              <button onClick={addHeader} className="btn-secondary">+ 添加 Header</button>

              {['POST', 'PUT', 'PATCH'].includes(method) && (
                <div className="section-title">Body</div>
              )}
              {['POST', 'PUT', 'PATCH'].includes(method) && (
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  placeholder='{"key": "value"}（支持 {{var}} 插值）'
                  rows={6}
                />
              )}
            </div>
          )}

          {requestTab === 'env' && (
            <div className="api-env-panel">
              {!activeEnv ? (
                <p className="panel-empty-text">尚未选择环境。点击右上角「+环境」创建，URL/Headers/Body 中的 {'{{var}}'} 将按激活环境插值。</p>
              ) : (
                <>
                  {Object.entries(activeEnv.variables).length === 0 && (
                    <p className="panel-empty-text">该环境暂无变量。</p>
                  )}
                  {Object.entries(activeEnv.variables).map(([k, v]) => (
                    <div key={k} className="header-row">
                      <input type="text" value={k} readOnly />
                      <input
                        type="text"
                        value={v}
                        onChange={(e) => updateEnvVar(activeEnv.id, k, e.target.value)}
                      />
                      <button className="btn-danger" onClick={() => removeEnvVar(activeEnv.id, k)}>×</button>
                    </div>
                  ))}
                  <EnvVarAdder onAdd={(k, v) => updateEnvVar(activeEnv.id, k, v)} />
                </>
              )}
            </div>
          )}

          {requestTab === 'assert' && (
            <div className="api-assert-panel">
              {assertions.map((a) => {
                const r = resultById.get(a.id)
                return (
                  <div key={a.id} className="api-assert-row">
                    <select
                      value={a.type}
                      onChange={(e) => updateAssertion(a.id, { type: e.target.value as ApiAssertion['type'] })}
                    >
                      <option value="status">状态码</option>
                      <option value="timeMs">耗时(ms)</option>
                      <option value="header">Header</option>
                      <option value="bodyContains">正文包含</option>
                      <option value="jsonPath">JSON 路径</option>
                    </select>
                    <input
                      type="text"
                      value={String(a.expected)}
                      onChange={(e) => updateAssertion(a.id, { expected: e.target.value })}
                      placeholder={a.type === 'header' ? 'Content-Type=application/json' : a.type === 'jsonPath' ? '$.data.id（路径）' : '200'}
                    />
                    {a.type === 'jsonPath' && (
                      <input
                        type="text"
                        value={String(a.expectedValue ?? '')}
                        onChange={(e) => updateAssertion(a.id, { expectedValue: e.target.value })}
                        placeholder="期望值"
                      />
                    )}
                    <span className={`assert-chip${r ? (r.pass ? ' pass' : ' fail') : ''}`}>
                      {r ? (r.pass ? '✓ 通过' : `✗ 实际 ${r.actual.slice(0, 30)}`) : '待发送'}
                    </span>
                    <button className="btn-danger" onClick={() => removeAssertion(a.id)}>×</button>
                  </div>
                )
              })}
              <button className="btn-secondary" onClick={addAssertion}>+ 添加断言</button>
            </div>
          )}
        </div>

        {statusCode !== null && (
          <div className="http-response">
            <div className="response-header">
              <h4>响应</h4>
              <div className="response-meta">
                <span className={`status ${statusCode < 400 ? 'success' : 'error'}`}>
                  {statusCode}
                </span>
                {duration !== null && <span>{duration}ms</span>}
                {assertResults && (
                  <span className={`assert-chip${assertResults.every((r) => r.pass) ? ' pass' : ' fail'}`}>
                    断言 {assertResults.filter((r) => r.pass).length}/{assertResults.length}
                  </span>
                )}
              </div>
            </div>
            <textarea value={response} readOnly rows={10} />
          </div>
        )}

        {history.length > 0 && (
          <div className="history-section">
            <h4>历史记录（{activeCollection?.name}）</h4>
            <div className="history-list">
              {history.slice(0, 10).map((req) => (
                <div
                  key={req.id}
                  className="history-item"
                  onClick={() => {
                    setMethod(req.method)
                    setUrl(req.url)
                    setBody(req.body || '')
                    setHeaders(Object.entries(req.headers).map(([k, v]) => ({ key: k, value: v })))
                    setAssertions(req.assertions ?? [])
                    setAssertResults(null)
                  }}
                >
                  <span className={`method ${req.method}`}>{req.method}</span>
                  <span className="url">{req.url}</span>
                  <span className="status">{req.statusCode}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** 环境变量追加行（独立小组件，避免污染主组件状态） */
function EnvVarAdder({ onAdd }: { onAdd: (key: string, value: string) => void }) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  return (
    <div className="header-row">
      <input type="text" value={k} onChange={(e) => setK(e.target.value)} placeholder="变量名" />
      <input type="text" value={v} onChange={(e) => setV(e.target.value)} placeholder="值" />
      <button
        className="btn-secondary"
        disabled={!k.trim()}
        onClick={() => {
          onAdd(k.trim(), v)
          setK('')
          setV('')
        }}
      >
        +
      </button>
    </div>
  )
}
