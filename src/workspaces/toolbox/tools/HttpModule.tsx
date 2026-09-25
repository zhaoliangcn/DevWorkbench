import { useState, useEffect } from 'react'
import type { HttpRequest } from '../../../types/toolbox'
import { HTTP_METHODS } from '../../../shared/constants'
import { electronAPI } from '../utils/electron'

export function HttpModule() {
  const [method, setMethod] = useState<'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'>('GET')
  const [url, setUrl] = useState('')
  const [headers, setHeaders] = useState<{ key: string; value: string }[]>([])
  const [body, setBody] = useState('')
  const [response, setResponse] = useState('')
  const [statusCode, setStatusCode] = useState<number | null>(null)
  const [duration, setDuration] = useState<number | null>(null)
  const [history, setHistory] = useState<HttpRequest[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    ;(async () => {
      const data = await electronAPI.loadData('requests') as { collections?: { requests: HttpRequest[] }[] } | null
      if (data?.collections) {
        setHistory(data.collections.flatMap((c) => c.requests))
      }
    })()
  }, [])

  const addHeader = () => {
    setHeaders([...headers, { key: '', value: '' }])
  }

  const updateHeader = (index: number, field: 'key' | 'value', value: string) => {
    const newHeaders = [...headers]
    newHeaders[index][field] = value
    setHeaders(newHeaders)
  }

  const removeHeader = (index: number) => {
    setHeaders(headers.filter((_, i) => i !== index))
  }

  const sendRequest = async () => {
    if (!url) return
    setLoading(true)

    const headersObj: Record<string, string> = {}
    headers.forEach((h) => {
      if (h.key) headersObj[h.key] = h.value
    })

    const startTime = Date.now()
    try {
      const config: RequestInit = {
        method,
        headers: headersObj,
      }

      if (['POST', 'PUT', 'PATCH'].includes(method) && body) {
        config.body = body
        if (!headersObj['Content-Type']) {
          config.headers = { ...headersObj, 'Content-Type': 'application/json' }
        }
      }

      const res = await fetch(url, config)
      const endTime = Date.now()
      const resText = await res.text()

      setResponse(resText)
      setStatusCode(res.status)
      setDuration(endTime - startTime)

      const request: HttpRequest = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        method,
        url,
        headers: headersObj,
        body,
        response: resText,
        statusCode: res.status,
        duration: endTime - startTime,
        createdAt: Date.now(),
      }

      const newHistory = [request, ...history].slice(0, 50)
      setHistory(newHistory)
      await electronAPI.saveData('requests', {
        collections: [{ id: 'default', name: '默认集合', requests: newHistory }],
      })
    } catch (e) {
      setResponse(`请求失败: ${(e as Error).message}`)
      setStatusCode(null)
      setDuration(null)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>接口调试</h3>
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
              placeholder="https://api.example.com/users"
            />
            <button onClick={sendRequest} disabled={!url || loading}>
              {loading ? '发送中...' : '发送'}
            </button>
          </div>

          <div className="tabs">
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
            </div>

            {['POST', 'PUT', 'PATCH'].includes(method) && (
              <div className="section-title">Body</div>
            )}
            {['POST', 'PUT', 'PATCH'].includes(method) && (
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder='{"key": "value"}'
                rows={6}
              />
            )}
          </div>
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
              </div>
            </div>
            <textarea value={response} readOnly rows={10} />
          </div>
        )}

        {history.length > 0 && (
          <div className="history-section">
            <h4>历史记录</h4>
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
