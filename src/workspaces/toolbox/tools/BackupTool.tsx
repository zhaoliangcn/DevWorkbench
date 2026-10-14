import { useEffect, useRef, useState } from 'react'

interface EstimateResult {
  fileCount: number
  totalBytes: number
  skippedFiles: number
  skippedDirs: number
  skippedSymlinks: number
  errorCount: number
}

interface RunResult {
  canceled?: boolean
  destPath: string
  zipPath?: string | null
  totalFound: number
  copied: number
  copiedBytes: number
  skippedFiles: number
  skippedDirs: number
  skippedSymlinks: number
  errors: string[]
  durationMs: number
}

interface BackupSettings {
  targetDir?: string
  files?: string
  dirs?: string
  patterns?: string
  overwrite?: boolean
  zip?: boolean
}

const SETTINGS_KEY = 'toolbox-backup-settings'

// 预置常见开发目录排除项，可直接修改
const DEFAULT_EXCLUDE_FILES = ['.DS_Store', 'Thumbs.db', 'desktop.ini']
const DEFAULT_EXCLUDE_DIRS = ['node_modules', '.git', 'dist', 'build', '__pycache__']
const DEFAULT_EXCLUDE_PATTERNS = ['*.log', '*.tmp', '~$*', '*.swp']

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let v = bytes / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toFixed(v >= 100 ? 0 : 2)} ${units[i]}`
}

const parseLines = (text: string): string[] =>
  text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)

export function BackupTool() {
  const [source, setSource] = useState<{ path: string; name: string } | null>(null)
  const [targetDir, setTargetDir] = useState('')
  const [backupName, setBackupName] = useState('')
  const [excludeFiles, setExcludeFiles] = useState(DEFAULT_EXCLUDE_FILES.join('\n'))
  const [excludeDirs, setExcludeDirs] = useState(DEFAULT_EXCLUDE_DIRS.join('\n'))
  const [excludePatterns, setExcludePatterns] = useState(DEFAULT_EXCLUDE_PATTERNS.join('\n'))
  const [overwrite, setOverwrite] = useState(false)
  const [zip, setZip] = useState(false)
  const [estimate, setEstimate] = useState<EstimateResult | null>(null)
  const [progress, setProgress] = useState<BackupProgress | null>(null)
  const [result, setResult] = useState<RunResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [running, setRunning] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const loadedRef = useRef(false)

  // 设置持久化（data:save/load，仅 Electron 环境；避免加载完成前把默认值写回）
  useEffect(() => {
    const api = window.electronAPI
    if (!api) return
    void api.data.load(SETTINGS_KEY).then((raw) => {
      const s = raw as BackupSettings | null
      if (s && typeof s === 'object') {
        if (typeof s.targetDir === 'string') setTargetDir(s.targetDir)
        if (typeof s.files === 'string') setExcludeFiles(s.files)
        if (typeof s.dirs === 'string') setExcludeDirs(s.dirs)
        if (typeof s.patterns === 'string') setExcludePatterns(s.patterns)
        if (typeof s.overwrite === 'boolean') setOverwrite(s.overwrite)
        if (typeof s.zip === 'boolean') setZip(s.zip)
      }
      loadedRef.current = true
    })
  }, [])

  useEffect(() => {
    if (!loadedRef.current) return
    const api = window.electronAPI
    if (!api) return
    const settings: BackupSettings = {
      targetDir,
      files: excludeFiles,
      dirs: excludeDirs,
      patterns: excludePatterns,
      overwrite,
      zip,
    }
    void api.data.save(SETTINGS_KEY, settings)
  }, [targetDir, excludeFiles, excludeDirs, excludePatterns, overwrite, zip])

  useEffect(() => {
    const api = window.electronAPI
    if (!api?.backup) return
    return api.backup.onProgress((p) => setProgress(p))
  }, [])

  const buildExcludes = () => ({
    files: parseLines(excludeFiles),
    dirs: parseLines(excludeDirs),
    patterns: parseLines(excludePatterns),
  })

  const pickSource = async () => {
    setError('')
    setStatus('')
    setEstimate(null)
    setResult(null)
    try {
      const api = window.electronAPI?.backup
      if (!api) throw new Error('仅在 Electron 环境可用')
      const r = await api.pickSource()
      if (!r.canceled && r.path && r.name) {
        setSource({ path: r.path, name: r.name })
        if (r.suggestedName) setBackupName(r.suggestedName)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const pickTarget = async () => {
    setError('')
    try {
      const api = window.electronAPI?.backup
      if (!api) throw new Error('仅在 Electron 环境可用')
      const r = await api.pickTarget()
      if (!r.canceled && r.path) setTargetDir(r.path)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const runEstimate = async () => {
    if (!source) return
    setError('')
    setStatus('')
    setResult(null)
    try {
      const api = window.electronAPI?.backup
      if (!api) throw new Error('仅在 Electron 环境可用')
      setBusy(true)
      setProgress(null)
      setEstimate(await api.estimate({ sourcePath: source.path, excludes: buildExcludes() }))
      setStatus('统计完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const runBackup = async () => {
    if (!source) return
    setError('')
    setStatus('')
    setEstimate(null)
    setResult(null)
    if (!targetDir) {
      setError('请先选择备份保存位置')
      return
    }
    if (!backupName.trim()) {
      setError('请填写备份名称')
      return
    }
    try {
      const api = window.electronAPI?.backup
      if (!api) throw new Error('仅在 Electron 环境可用')
      setBusy(true)
      setRunning(true)
      setProgress(null)
      const r = await api.run({
        sourcePath: source.path,
        targetDir,
        backupName,
        excludes: buildExcludes(),
        overwrite,
        zip,
      })
      setResult(r)
      setStatus(r.canceled ? '已取消（部分文件可能已复制）' : '备份完成')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
      setRunning(false)
      setProgress(null)
    }
  }

  const cancelBackup = async () => {
    await window.electronAPI?.backup?.cancel()
  }

  const progressPct =
    progress && (progress.phase === 'copy' || progress.phase === 'zip') && progress.total > 0
      ? Math.min(100, Math.round((progress.copied / progress.total) * 100))
      : null

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>文件夹备份</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>源文件夹</h4>
          <div className="tool-actions">
            <button onClick={pickSource} disabled={busy}>
              选择文件夹…
            </button>
          </div>
          {source && (
            <div className="file-info">
              <p>路径: {source.path}</p>
            </div>
          )}
        </div>

        {source && (
          <>
            <div className="tool-section">
              <h4>备份设置</h4>
              <div className="form-row">
                <label>保存位置</label>
                <div style={{ display: 'flex', gap: 8, flex: 1 }}>
                  <input value={targetDir} readOnly placeholder="选择备份文件的保存位置" />
                  <button onClick={pickTarget} disabled={busy}>
                    选择…
                  </button>
                </div>
              </div>
              <div className="form-row">
                <label>备份名称</label>
                <input
                  value={backupName}
                  onChange={(e) => setBackupName(e.target.value)}
                  placeholder="myproject-backup-20260101-120000"
                />
              </div>
              <label style={{ display: 'block', margin: '8px 0' }}>
                <input
                  type="checkbox"
                  checked={overwrite}
                  onChange={(e) => setOverwrite(e.target.checked)}
                />{' '}
                覆盖已存在的同名备份目录（合并写入，同名文件被替换）
              </label>
              <label style={{ display: 'block', margin: '8px 0' }}>
                <input type="checkbox" checked={zip} onChange={(e) => setZip(e.target.checked)} />{' '}
                备份后压缩为 zip（完成自动移除临时文件夹）
              </label>
              <p className="hint">备份将保存到「保存位置/备份名称」文件夹，选择源文件夹后自动生成默认名称</p>
            </div>

            <div className="tool-section">
              <h4>排除规则（每行一条）</h4>
              <div className="form-row">
                <label>排除文件</label>
                <textarea
                  rows={3}
                  value={excludeFiles}
                  onChange={(e) => setExcludeFiles(e.target.value)}
                  placeholder={'secret.key\nconfig.local.json'}
                />
              </div>
              <div className="form-row">
                <label>排除目录</label>
                <textarea
                  rows={3}
                  value={excludeDirs}
                  onChange={(e) => setExcludeDirs(e.target.value)}
                  placeholder={'node_modules\n.git'}
                />
              </div>
              <div className="form-row">
                <label>通配符排除</label>
                <textarea
                  rows={3}
                  value={excludePatterns}
                  onChange={(e) => setExcludePatterns(e.target.value)}
                  placeholder={'*.log\n*.tmp\ntemp*\ndist/**'}
                />
              </div>
              <p className="hint">
                通配符：* 匹配名称内任意字符，** 跨目录段，? 匹配单个字符；不含 / 时按文件/目录名匹配，含 /
                时按相对路径匹配；大小写不敏感。目录命中后整棵子树跳过；符号链接一律跳过。
              </p>
            </div>

            <div className="tool-section">
              <h4>执行</h4>
              <div className="tool-actions">
                <button onClick={runEstimate} disabled={busy}>
                  统计
                </button>
                <button onClick={runBackup} disabled={busy}>
                  {busy && running ? '备份中…' : '开始备份'}
                </button>
                {busy && running && (
                  <button onClick={cancelBackup} className="btn-secondary">
                    取消
                  </button>
                )}
              </div>
              {progress && busy && (
                <div>
                  <p className="hint">
                    {progress.phase === 'scan'
                      ? '正在扫描文件…'
                      : progress.phase === 'zip'
                        ? `正在压缩 zip ${progressPct ?? 0}%${progress.current ? ` — ${progress.current}` : ''}`
                        : `正在复制 ${progress.copied}/${progress.total}${progress.current ? ` — ${progress.current}` : ''}`}
                  </p>
                  {progressPct !== null && (
                    <div
                      style={{
                        height: 6,
                        background: 'var(--border, rgba(128,128,128,0.25))',
                        borderRadius: 3,
                        overflow: 'hidden',
                        margin: '8px 0',
                      }}
                    >
                      <div
                        style={{
                          width: `${progressPct}%`,
                          height: '100%',
                          background: 'var(--primary, #4a7dff)',
                          transition: 'width 0.2s',
                        }}
                      />
                    </div>
                  )}
                </div>
              )}
              {estimate && (
                <div className="file-info">
                  <p>
                    将复制 {estimate.fileCount} 个文件，共 {formatBytes(estimate.totalBytes)}
                  </p>
                  <p>
                    跳过：文件 {estimate.skippedFiles}、目录 {estimate.skippedDirs}、符号链接{' '}
                    {estimate.skippedSymlinks}
                    {estimate.errorCount > 0 ? `、异常 ${estimate.errorCount}` : ''}
                  </p>
                </div>
              )}
              {result && (
                <div className="file-info">
                  <p>
                    {result.canceled ? '已取消（部分完成）' : '备份完成'}：{result.copied}/
                    {result.totalFound} 个文件（{formatBytes(result.copiedBytes)}），耗时{' '}
                    {(result.durationMs / 1000).toFixed(1)} 秒
                  </p>
                  <p>位置: {result.zipPath ?? result.destPath}</p>
                  {result.zipPath && <p className="hint">已打包为 zip 并移除临时文件夹</p>}
                  {(result.skippedFiles > 0 ||
                    result.skippedDirs > 0 ||
                    result.skippedSymlinks > 0) && (
                    <p>
                      跳过：文件 {result.skippedFiles}、目录 {result.skippedDirs}、符号链接{' '}
                      {result.skippedSymlinks}
                    </p>
                  )}
                  {result.errors.length > 0 && (
                    <p style={{ color: 'var(--danger, #e5484d)' }}>
                      {result.errors.length} 个错误：{result.errors.slice(0, 3).join('；')}
                      {result.errors.length > 3 ? '…' : ''}
                    </p>
                  )}
                </div>
              )}
              {status && <p className="hint">{status}</p>}
              {error && <p style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
