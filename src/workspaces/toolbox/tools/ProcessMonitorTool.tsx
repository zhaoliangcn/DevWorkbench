import { useEffect, useMemo, useState } from 'react'
import { Pause, Play, RefreshCw, Skull } from 'lucide-react'
import { electronAPI } from '../utils/electron'
import { parsePsOutput, parseTasklistCsv, sortProcs } from './pure/processes'
import type { ProcRow, ProcSortKey } from './pure/processes'

const INTERVAL_MS = 3000

const COLUMNS: { key: ProcSortKey; label: string; numeric: boolean }[] = [
  { key: 'command', label: '进程', numeric: false },
  { key: 'pid', label: 'PID', numeric: true },
  { key: 'cpu', label: 'CPU %', numeric: true },
  { key: 'mem', label: 'MEM', numeric: true },
]

export function ProcessMonitorTool() {
  const [procs, setProcs] = useState<ProcRow[]>([])
  const [running, setRunning] = useState(true)
  const [query, setQuery] = useState('')
  const [sortKey, setSortKey] = useState<ProcSortKey>('cpu')
  const [sortDesc, setSortDesc] = useState(true)
  const [kind, setKind] = useState('')
  const [error, setError] = useState('')
  const [killingPid, setKillingPid] = useState(0)
  const [reloadKey, setReloadKey] = useState(0)

  // 轮询加载：await 之后 setState，与 DockerModule 同模式
  useEffect(() => {
    if (!running) return
    let cancelled = false
    const load = async () => {
      const r = await electronAPI.listProcesses()
      if (cancelled) return
      if (r.success) {
        setKind(r.kind)
        setProcs(r.kind === 'win' ? parseTasklistCsv(r.raw) : parsePsOutput(r.raw))
        setError('')
      } else {
        setError(r.error ?? '获取进程列表失败')
      }
    }
    load()
    const timer = setInterval(load, INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [running, reloadKey])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = q ? procs.filter((p) => p.command.toLowerCase().includes(q)) : procs
    return sortProcs(base, sortKey, sortDesc)
  }, [procs, query, sortKey, sortDesc])

  const toggleSort = (key: ProcSortKey) => {
    if (key === sortKey) {
      setSortDesc((d) => !d)
    } else {
      setSortKey(key)
      setSortDesc(true)
    }
  }

  const kill = async (pid: number) => {
    setKillingPid(pid)
    await electronAPI.killProcess(pid)
    setKillingPid(0)
    setReloadKey((k) => k + 1)
  }

  const totalCpu = useMemo(
    () => procs.reduce((sum, p) => sum + p.cpu, 0),
    [procs]
  )

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>进程监视</h3>
      </div>
      <div className="module-body">
        <div className="procmon-toolbar">
          <input
            className="procmon-search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="按进程名过滤…"
          />
          <span className="procmon-meta">
            {procs.length} 个进程 · CPU 合计 {totalCpu.toFixed(1)}%
          </span>
          <button onClick={() => setRunning((r) => !r)} title={running ? '暂停刷新' : '恢复刷新'}>
            {running ? <Pause size={14} /> : <Play size={14} />}
          </button>
          <button
            onClick={() => setReloadKey((k) => k + 1)}
            disabled={running}
            title="立即刷新"
          >
            <RefreshCw size={14} />
          </button>
        </div>

        {error && <p className="procmon-error">{error}</p>}

        <div className="procmon-table">
          <div className="procmon-row procmon-head">
            {COLUMNS.map((c) => (
              <button
                key={c.key}
                className={`procmon-sort ${sortKey === c.key ? 'active' : ''}`}
                onClick={() => toggleSort(c.key)}
              >
                {c.label}
                {sortKey === c.key ? (sortDesc ? ' ↓' : ' ↑') : ''}
              </button>
            ))}
            <span>操作</span>
          </div>
          {filtered.map((p) => (
            <div key={`${p.pid}-${p.command}`} className="procmon-row">
              <span className="procmon-command" title={p.command}>{p.command}</span>
              <span className="procmon-num">{p.pid}</span>
              <span className="procmon-num">{p.cpu.toFixed(1)}</span>
              <span className="procmon-num">{p.mem.toFixed(1)}{kind === 'win' ? ' MB' : '%'}</span>
              <span className="procmon-actions">
                <button
                  className="danger"
                  disabled={killingPid === p.pid}
                  onClick={() => kill(p.pid)}
                  title={`kill -9 ${p.pid}`}
                >
                  <Skull size={12} />
                </button>
              </span>
            </div>
          ))}
          {!error && filtered.length === 0 && <p className="tool-hint">无匹配进程</p>}
        </div>
        <p className="tool-hint">每 {INTERVAL_MS / 1000} 秒自动刷新 · CPU/MEM 排序 · 一键结束进程</p>
      </div>
    </div>
  )
}
