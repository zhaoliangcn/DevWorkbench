import { useMemo, useRef, useState } from 'react'
import {
  MAX_TOTAL_UNCOMPRESSED,
  detectArchiveFormat,
  extractArchive,
  inspectArchive,
  planExtraction,
  prepareArchive,
  type ArchiveFormat,
  type ArchiveInspection,
  type ConflictPolicy,
  type FormatInfo,
  type PreparedFormat,
  type SkipReason,
} from './pure/archive'

interface SourceFile {
  path: string
  name: string
  size: number
}

interface ProgressState {
  done: number
  total: number
  current: string
}

interface ResultState extends ArchiveSummary {
  durationMs: number
}

const FORMAT_LABELS: Record<ArchiveFormat, string> = {
  zip: 'ZIP',
  tar: 'TAR',
  'tar.gz': 'TAR.GZ',
  gz: 'GZ',
  rar: 'RAR',
  '7z': '7z',
  unknown: '未知',
}

const SKIP_LABELS: Record<SkipReason, string> = {
  unsafe: '路径不安全',
  symlink: '符号链接',
  hardlink: '硬链接',
  encrypted: '加密',
  unsupported: '方法不支持',
  duplicate: '同名跳过',
  other: '其他类型',
}

const DISPLAY_LIMIT = 2000
const FLUSH_BYTES = 8 * 1024 * 1024
const FLUSH_ITEMS = 500

const PLATFORM: 'win32' | 'darwin' | 'linux' = /Windows/i.test(navigator.userAgent)
  ? 'win32'
  : /Mac/i.test(navigator.userAgent)
    ? 'darwin'
    : 'linux'

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value.toFixed(value >= 100 ? 0 : 2)} ${units[index]}`
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunk = 0x8000
  let binary = ''
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

export function ArchiveTool() {
  const [file, setFile] = useState<SourceFile | null>(null)
  const [formatInfo, setFormatInfo] = useState<FormatInfo | null>(null)
  const [inspection, setInspection] = useState<ArchiveInspection | null>(null)
  const [targetDir, setTargetDir] = useState('')
  const [conflict, setConflict] = useState<ConflictPolicy>('rename')
  const [filter, setFilter] = useState('')
  const [progress, setProgress] = useState<ProgressState | null>(null)
  const [result, setResult] = useState<ResultState | null>(null)
  const [parsing, setParsing] = useState(false)
  const [running, setRunning] = useState(false)
  const [cancelRequested, setCancelRequested] = useState(false)
  const [error, setError] = useState('')

  /** 解压引擎输入的原始字节（tar.gz 已预解压为 tar），体积大不进 React state */
  const sourceRef = useRef<{ bytes: Uint8Array; format: PreparedFormat } | null>(null)
  const cancelRef = useRef(false)
  const pickTokenRef = useRef(0)

  const plan = useMemo(
    () => (inspection ? planExtraction(inspection, { conflict, platform: PLATFORM }) : null),
    [inspection, conflict],
  )
  // PLATFORM 为模块级常量，不会变化

  const skipMap = useMemo(() => {
    const map = new Map<number, SkipReason>()
    for (const item of plan?.items ?? []) {
      if (item.targetPath === null && item.skipReason) map.set(item.index, item.skipReason)
    }
    return map
  }, [plan])

  const filteredEntries = useMemo(() => {
    if (!inspection) return []
    const keyword = filter.trim().toLowerCase()
    if (!keyword) return inspection.entries
    return inspection.entries.filter(
      (entry) => entry.rawPath.toLowerCase().includes(keyword) || entry.path?.toLowerCase().includes(keyword),
    )
  }, [inspection, filter])

  const busy = parsing || running

  const resetSession = () => {
    sourceRef.current = null
    setInspection(null)
    setTargetDir('')
    setProgress(null)
    setResult(null)
    setFilter('')
    setError('')
  }

  const pickArchive = async () => {
    const api = window.electronAPI?.archive
    if (!api) {
      setError('仅在 Electron 环境可用')
      return
    }
    setError('')
    resetSession()
    setFormatInfo(null)
    try {
      const picked = await api.pick()
      if (picked.canceled) return
      const token = ++pickTokenRef.current
      setFile({ path: picked.path, name: picked.name, size: picked.size })

      // 先按扩展名判断：RAR/7z 等不支持格式直接提示，避免把大文件读进渲染层
      const guess = detectArchiveFormat(picked.name)
      setFormatInfo(guess)
      if (!guess.supported) return

      setParsing(true)
      const read = await api.readBytes()
      if (token !== pickTokenRef.current) return
      const bytes = base64ToBytes(read.base64)
      const detected = detectArchiveFormat(picked.name, bytes)
      setFormatInfo(detected)
      if (!detected.supported) return

      const prepared = await prepareArchive(bytes, detected.format)
      const list = await inspectArchive(prepared.bytes, prepared.format, picked.name)
      if (token !== pickTokenRef.current) return
      sourceRef.current = { bytes: prepared.bytes, format: prepared.format }
      setInspection(list)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setParsing(false)
    }
  }

  const pickTarget = async () => {
    const api = window.electronAPI?.archive
    if (!api) return
    setError('')
    try {
      const picked = await api.pickTarget()
      if (!picked.canceled && picked.path) setTargetDir(picked.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const applyBatch = (
    stats: { written: number; overwritten: number; skipped: number; renamed: number; dirs: number },
    batch: { written: number; overwritten: number; skipped: number; renamed: number; dirs: number },
  ) => {
    stats.written += batch.written
    stats.overwritten += batch.overwritten
    stats.skipped += batch.skipped
    stats.renamed += batch.renamed
    stats.dirs += batch.dirs
  }

  const runExtract = async () => {
    const api = window.electronAPI?.archive
    const source = sourceRef.current
    if (!api || !source || !inspection) return
    if (!targetDir) {
      setError('请先选择解压输出目录')
      return
    }
    if (inspection.totalBytes > MAX_TOTAL_UNCOMPRESSED) {
      setError(`解压后总大小超过 ${MAX_TOTAL_UNCOMPRESSED / 1024 / 1024}MB 上限，无法解压`)
      return
    }
    const currentPlan = planExtraction(inspection, { conflict, platform: PLATFORM })
    if (!currentPlan.plannedCount) {
      setError('没有可解压的条目（可能全部为符号链接、加密或不安全路径）')
      return
    }

    setError('')
    setResult(null)
    setProgress({ done: 0, total: Math.max(inspection.totalBytes, 1), current: '' })
    setCancelRequested(false)
    cancelRef.current = false
    setRunning(true)

    const started = Date.now()
    let opId = ''
    const stats = { written: 0, overwritten: 0, skipped: 0, renamed: 0, dirs: 0 }
    let batch: { path: string; kind: 'file' | 'dir'; base64?: string }[] = []
    let batchBytes = 0
    let lastReport = 0

    const flush = async () => {
      if (!batch.length) return
      const items = batch
      batch = []
      batchBytes = 0
      const response = await api.writeBatch({ opId, items })
      applyBatch(stats, response)
      if (response.canceled) cancelRef.current = true
    }

    try {
      const session = await api.writeStart({ conflict })
      opId = session.opId

      const onProgress = (done: number, total: number, current: string) => {
        const now = Date.now()
        if (now - lastReport < 100 && done < total) return
        lastReport = now
        setProgress({ done, total, current })
      }

      for await (const item of extractArchive(source.bytes, source.format, inspection, currentPlan.items, {
        onProgress,
        isCancelled: () => cancelRef.current,
      })) {
        if (cancelRef.current) break
        if (item.kind === 'dir') {
          batch.push({ path: item.path, kind: 'dir' })
        } else {
          const base64 = bytesToBase64(item.data ?? new Uint8Array())
          batch.push({ path: item.path, kind: 'file', base64 })
          batchBytes += base64.length
        }
        if (batch.length >= FLUSH_ITEMS || batchBytes >= FLUSH_BYTES) await flush()
        if (cancelRef.current) break
      }

      if (!cancelRef.current) await flush()
      if (cancelRef.current) await api.cancel()

      const summary = await api.finish({ opId, abort: cancelRef.current })
      setResult({ ...summary, durationMs: Date.now() - started })
      if (!summary.canceled) {
        const total = inspection.totalBytes || 1
        setProgress({ done: total, total, current: '' })
      }
    } catch (err) {
      // 异常/取消：销毁本次写入会话，主进程回收新建文件与空目录
      const message = err instanceof Error ? err.message : String(err)
      let cleaned = 0
      try {
        const cleanup = await api.finish({ opId, abort: true })
        cleaned = cleanup.cleaned
      } catch {
        // 会话已失效时忽略
      }
      setError(cleaned > 0 ? `${message}（已清理本次新建的 ${cleaned} 项）` : message)
    } finally {
      setRunning(false)
      setCancelRequested(false)
    }
  }

  const requestCancel = () => {
    cancelRef.current = true
    setCancelRequested(true)
    void window.electronAPI?.archive?.cancel()
  }

  const progressPct =
    progress && progress.total > 0 ? Math.min(100, Math.round((progress.done / progress.total) * 100)) : 0

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>文件解压</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>压缩包</h4>
          <div className="tool-actions">
            <button onClick={pickArchive} disabled={busy}>
              选择压缩包…
            </button>
          </div>
          {file && (
            <div className="file-info">
              <p>文件: {file.name}</p>
              <p>路径: {file.path}</p>
              <p>
                大小: {formatBytes(file.size)}
                {formatInfo && ` · 格式: ${FORMAT_LABELS[formatInfo.format] ?? formatInfo.format}`}
              </p>
            </div>
          )}
          {parsing && <p className="hint">正在读取并解析压缩包…</p>}
          {formatInfo && !formatInfo.supported && (
            <div className="archive-notice archive-notice-danger">
              {formatInfo.reason ?? '暂不支持该压缩格式'}
              <p className="archive-notice-sub">
                支持格式：zip、tar、tar.gz/tgz、gz。RAR/7z 需外部二进制或第三方解析库，为保证零额外依赖暂不接入，
                可使用系统 7-Zip / WinRAR 处理。
              </p>
            </div>
          )}
        </div>

        {inspection && (
          <>
            <div className="tool-section">
              <h4>包内结构</h4>
              <div className="archive-summary">
                <span>{FORMAT_LABELS[formatInfo?.format ?? inspection.format] ?? inspection.format}</span>
                <span>条目 {inspection.declaredCount}</span>
                <span>
                  文件 {inspection.totalFiles} / 目录 {inspection.totalDirs}
                </span>
                <span>解压后 {formatBytes(inspection.totalBytes)}</span>
              </div>

              {inspection.encryptedCount > 0 && (
                <div className="archive-notice archive-notice-warn">
                  检测到 {inspection.encryptedCount} 个加密条目：暂不支持密码解压（需要外部库），将跳过这些条目。
                </div>
              )}
              {inspection.unsafeCount > 0 && (
                <div className="archive-notice archive-notice-danger">
                  检测到 {inspection.unsafeCount} 个不安全路径（绝对路径 / ../ 穿越 / 非法字符），已拒绝解压。
                </div>
              )}
              {inspection.symlinkCount > 0 && (
                <div className="archive-notice archive-notice-warn">
                  检测到 {inspection.symlinkCount} 个符号链接/硬链接：为避免越权写入，默认跳过。
                </div>
              )}
              {inspection.unsupportedCount > 0 && (
                <div className="archive-notice archive-notice-warn">
                  {inspection.unsupportedCount} 个条目使用了暂不支持的压缩方法（非 Store/Deflate），将跳过。
                </div>
              )}
              {inspection.warnings.map((warning) => (
                <div key={warning} className="archive-notice archive-notice-warn">
                  {warning}
                </div>
              ))}

              <input
                className="archive-search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder="按路径筛选条目…"
                disabled={running}
              />
              <div className="archive-entry-list">
                {filteredEntries.slice(0, DISPLAY_LIMIT).map((entry) => {
                  const skipReason = skipMap.get(entry.index)
                  const icon =
                    entry.kind === 'dir' ? '📁' : entry.kind === 'symlink' || entry.kind === 'hardlink' ? '🔗' : '📄'
                  return (
                    <div className="archive-entry" key={entry.index}>
                      <span className="archive-entry-icon">{icon}</span>
                      <span className="archive-entry-name" title={entry.rawPath}>
                        {entry.path ?? entry.rawPath}
                        {entry.path === null && entry.unsafeReason ? (
                          <em className="archive-entry-unsafe">（{entry.unsafeReason}）</em>
                        ) : null}
                      </span>
                      <span className="archive-entry-meta">
                        {entry.kind === 'dir' ? '目录' : entry.sizeUnknown ? '—' : formatBytes(entry.size)}
                      </span>
                      {skipReason && <span className="archive-entry-badge">{SKIP_LABELS[skipReason]}</span>}
                    </div>
                  )
                })}
                {!filteredEntries.length && <p className="archive-empty">没有匹配的条目</p>}
              </div>
              {filteredEntries.length > DISPLAY_LIMIT && (
                <p className="hint">
                  共 {filteredEntries.length} 条匹配，仅显示前 {DISPLAY_LIMIT} 条（解压仍会处理全部条目）。
                </p>
              )}
            </div>

            <div className="tool-section">
              <h4>解压设置</h4>
              <div className="form-row">
                <label>输出目录</label>
                <div className="archive-dir-row">
                  <input value={targetDir} readOnly placeholder="选择解压输出目录" />
                  <button onClick={pickTarget} disabled={running}>
                    选择…
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label>同名处理</label>
                <select
                  value={conflict}
                  onChange={(e) => setConflict(e.target.value as ConflictPolicy)}
                  disabled={running}
                >
                  <option value="rename">自动重命名（name (1).ext）</option>
                  <option value="overwrite">覆盖已有文件</option>
                  <option value="skip">跳过同名文件</option>
                </select>
              </div>

              {plan && (
                <p className="hint">
                  将解压 {plan.plannedCount} 项；跳过：不安全 {plan.skipped.unsafe}、符号链接{' '}
                  {plan.skipped.symlink + plan.skipped.hardlink}、加密 {plan.skipped.encrypted}、不支持方法{' '}
                  {plan.skipped.unsupported}
                  {plan.skipped.duplicate ? `、同名 ${plan.skipped.duplicate}` : ''}
                  {plan.skipped.other ? `、其他 ${plan.skipped.other}` : ''}。
                </p>
              )}

              <div className="tool-actions">
                <button onClick={runExtract} disabled={running || !targetDir}>
                  {running ? '解压中…' : '开始解压'}
                </button>
                {running && (
                  <button onClick={requestCancel} className="btn-secondary" disabled={cancelRequested}>
                    {cancelRequested ? '正在取消…' : '取消'}
                  </button>
                )}
              </div>

              {running && progress && (
                <div className="archive-progress">
                  <div className="archive-progress-track">
                    <div className="archive-progress-bar" style={{ width: `${progressPct}%` }} />
                  </div>
                  <p className="hint">
                    {progressPct}% · {formatBytes(progress.done)} / {formatBytes(progress.total)}
                    {progress.current ? ` — ${progress.current}` : ''}
                  </p>
                </div>
              )}

              {result && (
                <div className="file-info">
                  <p>
                    {result.canceled ? '已取消' : '解压完成'}：写入 {result.written} 个文件
                    {result.dirs ? `、${result.dirs} 个目录` : ''}（{formatBytes(result.writtenBytes)}），耗时{' '}
                    {(result.durationMs / 1000).toFixed(1)} 秒
                  </p>
                  <p>输出位置: {targetDir}</p>
                  {result.overwritten > 0 && <p className="hint">覆盖已有文件 {result.overwritten} 个</p>}
                  {result.renamed > 0 && <p className="hint">同名自动重命名 {result.renamed} 个</p>}
                  {result.skipped > 0 && <p className="hint">跳过已存在的同名文件 {result.skipped} 个</p>}
                  {result.cleaned > 0 && (
                    <p className="hint">
                      已清理本次新建的文件/空目录 {result.cleaned} 项（已覆盖的旧文件无法自动恢复）
                    </p>
                  )}
                  {result.errorCount > 0 && (
                    <p className="archive-error-text">
                      {result.errorCount} 个写入失败：{result.errors.slice(0, 3).join('；')}
                      {result.errorCount > 3 ? '…' : ''}
                    </p>
                  )}
                </div>
              )}
            </div>
          </>
        )}

        {error && <p className="archive-error-text">{error}</p>}
      </div>
    </div>
  )
}
