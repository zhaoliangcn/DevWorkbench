import { useEffect, useState } from 'react'
import { RefreshCw, ScrollText, X } from 'lucide-react'
import { electronAPI } from '../utils/electron'
import { toContainerRows, toImageRows } from './pure/docker'
import type { DockerContainerRow, DockerImageRow } from './pure/docker'

type Tab = 'containers' | 'images'

function stateClass(state: string): string {
  if (state === 'running') return 'running'
  if (state === 'paused') return 'paused'
  return 'exited'
}

export function DockerModule() {
  const [available, setAvailable] = useState<boolean | null>(null)
  const [version, setVersion] = useState('')
  const [checkError, setCheckError] = useState('')
  const [tab, setTab] = useState<Tab>('containers')
  const [containers, setContainers] = useState<DockerContainerRow[]>([])
  const [images, setImages] = useState<DockerImageRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState('')
  const [logsFor, setLogsFor] = useState<{ id: string; name: string } | null>(null)
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)
  const [checkKey, setCheckKey] = useState(0)

  // 挂载 / 手动重检测 Docker 可用性（setState 均在 await 之后，规避级联渲染）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await electronAPI.dockerCheck()
      if (cancelled) return
      setAvailable(r.available)
      setVersion(r.version ?? '')
      setCheckError(r.error ?? '')
    })()
    return () => {
      cancelled = true
    }
  }, [checkKey])

  // available / tab / 手动刷新触发列表加载
  useEffect(() => {
    if (!available) return
    let cancelled = false
    ;(async () => {
      setError('')
      if (tab === 'containers') {
        const r = await electronAPI.dockerContainers()
        if (cancelled) return
        if (r.success) setContainers(toContainerRows(r.raw))
        else setError(r.error ?? '获取容器失败')
      } else {
        const r = await electronAPI.dockerImages()
        if (cancelled) return
        if (r.success) setImages(toImageRows(r.raw))
        else setError(r.error ?? '获取镜像失败')
      }
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [available, tab, reloadKey])

  const handleRefresh = () => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }

  const handleRecheck = () => {
    setAvailable(null)
    setCheckKey((k) => k + 1)
  }

  const switchTab = (next: Tab) => {
    setTab(next)
    setLoading(true)
  }

  const runAction = async (action: string, row: DockerContainerRow) => {
    setBusyId(row.id)
    const r = await electronAPI.dockerAction(action, row.id)
    if (!r.success) setError(r.error ?? `${action} 失败`)
    setBusyId('')
    setReloadKey((k) => k + 1)
  }

  const openLogs = async (row: DockerContainerRow) => {
    setLogsFor({ id: row.id, name: row.name })
    setLogs('')
    setLogsLoading(true)
    const r = await electronAPI.dockerLogs(row.id, 300)
    setLogs(r.success ? r.logs : r.error ?? '获取日志失败')
    setLogsLoading(false)
  }

  if (available === null) {
    return (
      <div className="module-container">
        <div className="module-header">
          <h3>Docker 面板</h3>
        </div>
        <div className="module-body">
          <p className="tool-hint">检测 Docker 环境…</p>
        </div>
      </div>
    )
  }

  if (!available) {
    return (
      <div className="module-container">
        <div className="module-header">
          <h3>Docker 面板</h3>
        </div>
        <div className="module-body">
          <div className="tool-section">
            <p className="tool-hint">未检测到可用的 Docker（需要安装并启动 Docker Desktop / daemon）</p>
            {checkError && <p className="tool-hint">{checkError}</p>}
            <button onClick={handleRecheck}>重新检测</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>Docker 面板{version ? ` · v${version}` : ''}</h3>
      </div>
      <div className="module-body">
        <div className="docker-toolbar">
          <div className="docker-tabs">
            <button className={tab === 'containers' ? 'active' : ''} onClick={() => switchTab('containers')}>
              容器 ({containers.length})
            </button>
            <button className={tab === 'images' ? 'active' : ''} onClick={() => switchTab('images')}>
              镜像 ({images.length})
            </button>
          </div>
          <button onClick={handleRefresh} disabled={loading} title="刷新">
            <RefreshCw size={14} />
          </button>
        </div>

        {error && <p className="docker-error">{error}</p>}

        {tab === 'containers' ? (
          <div className="docker-table">
            <div className="docker-row docker-head">
              <span>名称</span>
              <span>镜像</span>
              <span>状态</span>
              <span>端口</span>
              <span>操作</span>
            </div>
            {containers.map((c) => (
              <div key={c.id} className="docker-row">
                <span className="docker-name" title={c.id}>{c.name}</span>
                <span className="docker-image" title={c.image}>{c.image}</span>
                <span className={`docker-state ${stateClass(c.state)}`}>{c.status}</span>
                <span className="docker-ports" title={c.ports}>{c.ports || '—'}</span>
                <span className="docker-actions">
                  {c.state === 'running' ? (
                    <button disabled={busyId === c.id} onClick={() => runAction('stop', c)}>停止</button>
                  ) : (
                    <button disabled={busyId === c.id} onClick={() => runAction('start', c)}>启动</button>
                  )}
                  <button disabled={busyId === c.id} onClick={() => runAction('restart', c)}>重启</button>
                  <button disabled={busyId === c.id} onClick={() => openLogs(c)} title="查看日志">
                    <ScrollText size={12} />
                  </button>
                  <button
                    className="danger"
                    disabled={busyId === c.id}
                    onClick={() => runAction('remove', c)}
                  >
                    删除
                  </button>
                </span>
              </div>
            ))}
            {!loading && containers.length === 0 && <p className="tool-hint">暂无容器</p>}
          </div>
        ) : (
          <div className="docker-table">
            <div className="docker-row docker-head">
              <span>仓库</span>
              <span>标签</span>
              <span>ID</span>
              <span>创建时间</span>
              <span>大小</span>
            </div>
            {images.map((img) => (
              <div key={`${img.repository}:${img.tag}:${img.id}`} className="docker-row">
                <span className="docker-name" title={img.repository}>{img.repository}</span>
                <span>{img.tag}</span>
                <span className="docker-mono">{img.id}</span>
                <span>{img.created}</span>
                <span>{img.size}</span>
              </div>
            ))}
            {!loading && images.length === 0 && <p className="tool-hint">暂无镜像</p>}
          </div>
        )}

        {logsFor && (
          <div className="docker-logs">
            <div className="docker-logs-head">
              <span>日志 · {logsFor.name}</span>
              <button onClick={() => setLogsFor(null)} title="关闭">
                <X size={12} />
              </button>
            </div>
            <pre className="docker-logs-body">{logsLoading ? '加载中…' : logs || '（无输出）'}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
