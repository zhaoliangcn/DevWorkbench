import { useCallback, useEffect, useRef, useState } from 'react'
import { Download, Eye, FilePlus2, FolderOpen, KeyRound, Lock, ShieldCheck, Trash2, Unlock } from 'lucide-react'
import { electronAPI } from '../utils/electron'

type Phase = 'loading' | 'uninitialized' | 'locked' | 'unlocked'

interface Progress {
  op: string
  name?: string
  pct: number
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/** 文件保险柜：主密码 + AES-256-GCM 流式容器，文件字节全程不进渲染层（预览除外，≤5MB） */
export function FileVaultTool() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [status, setStatus] = useState<SecFileStatus | null>(null)
  const [error, setError] = useState('')
  const [progress, setProgress] = useState<Progress | null>(null)
  const [preview, setPreview] = useState<{ name: string; kind: 'text' | 'image'; mime: string; text?: string; dataUrl?: string } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const dropRef = useRef<HTMLDivElement>(null)

  // 创建表单
  const [dir, setDir] = useState('')
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [autoLockMin, setAutoLockMin] = useState('5')
  // 导入表单
  const [showImport, setShowImport] = useState(false)
  const [bundlePath, setBundlePath] = useState('')
  const [importDir, setImportDir] = useState('')
  const [importPw, setImportPw] = useState('')

  const applyStatus = useCallback((s: SecFileStatus) => {
    setStatus(s)
    setPhase(s.exists ? (s.unlocked ? 'unlocked' : 'locked') : 'uninitialized')
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const s = await electronAPI.secfileStatus()
      if (!cancelled) applyStatus(s)
    }
    void load()
    const off = electronAPI.onSecfileProgress((p) => {
      if (p.op === 'autolock') {
        setPhase('locked')
        setProgress(null)
        void electronAPI.secfileStatus().then((s) => setStatus(s))
        return
      }
      setProgress(p.done ? null : { op: p.op, name: p.name, pct: p.pct ?? 0 })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [applyStatus])

  const createVault = async () => {
    setError('')
    if (!dir) return setError('请选择保险柜目录')
    if (pw !== pw2) return setError('两次输入的密码不一致')
    const r = await electronAPI.secfileCreate({ dir, password: pw, autoLockMin: Number(autoLockMin) || 5 })
    if (!r.ok) return setError(r.error ?? '创建失败')
    setPw('')
    setPw2('')
    if (r.status) applyStatus(r.status)
    setPhase('unlocked')
  }

  const unlock = async () => {
    setError('')
    const r = await electronAPI.secfileUnlock(pw)
    if (!r.ok) return setError(r.error ?? '解锁失败')
    setPw('')
    if (r.status) applyStatus(r.status)
    setPhase('unlocked')
  }

  const lock = async () => {
    await electronAPI.secfileLock()
    setPhase('locked')
    setPreview(null)
    await electronAPI.secfileStatus().then(applyStatus)
  }

  const addViaDialog = async () => {
    const paths = await electronAPI.secfilePickFiles()
    if (paths.length) await doAdd(paths)
  }

  const doAdd = async (paths: string[]) => {
    setError('')
    const r = await electronAPI.secfileAddPaths(paths)
    setProgress(null)
    if (r.errors.length) setError(r.errors.join('；'))
    if (r.status) applyStatus(r.status)
  }

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    if (phase !== 'unlocked') return
    const paths = Array.from(e.dataTransfer.files)
      .map((f) => electronAPI.secfileGetPathForFile(f))
      .filter(Boolean)
    if (paths.length) await doAdd(paths)
  }

  const exportFile = async (id: string) => {
    setError('')
    const r = await electronAPI.secfileExportFile(id)
    setProgress(null)
    if (!r.ok && r.error && r.error !== '已取消') setError(r.error)
  }

  const removeFile = async (id: string, name: string) => {
    if (!window.confirm(`从保险柜删除「${name}」？不可恢复。`)) return
    const r = await electronAPI.secfileRemove(id)
    if (r.status) applyStatus(r.status)
  }

  const doPreview = async (id: string) => {
    setError('')
    const r = await electronAPI.secfilePreview(id)
    if (!r.ok) return setError(r.error ?? '预览失败')
    if (r.kind === 'image') {
      setPreview({ name: r.name!, kind: 'image', mime: r.mime!, dataUrl: `data:${r.mime};base64,${r.base64}` })
    } else {
      const text = new TextDecoder().decode(Uint8Array.from(atob(r.base64!), (c) => c.charCodeAt(0)))
      setPreview({ name: r.name!, kind: 'text', mime: r.mime!, text })
    }
  }

  const exportBundle = async () => {
    setError('')
    const r = await electronAPI.secfileExportBundle()
    setProgress(null)
    if (!r.ok && r.error && r.error !== '已取消') setError(r.error)
  }

  const doImport = async () => {
    setError('')
    if (!bundlePath || !importDir) return setError('请选择迁移文件与目标目录')
    const r = await electronAPI.secfileImportBundle({ bundlePath, dir: importDir, password: importPw })
    if (!r.ok) return setError(r.error ?? '导入失败')
    setShowImport(false)
    setBundlePath('')
    setImportDir('')
    setImportPw('')
    if (r.status) applyStatus(r.status)
    setPhase('locked')
  }

  /* ---------- 渲染 ---------- */

  if (phase === 'loading') return <div className="tool-container"><p className="tool-hint">加载保险柜状态…</p></div>

  const gate = (children: React.ReactNode) => (
    <div className="tool-container">
      <div className="tool-header"><h3>文件保险柜</h3></div>
      <div className="tool-body">
        <div className="secvault-gate">
          <KeyRound size={28} />
          {children}
          {error && <div className="secvault-error">{error}</div>}
        </div>
      </div>
    </div>
  )

  if (phase === 'uninitialized') {
    return gate(
      <>
        <h4>创建文件保险柜</h4>
        <p className="tool-hint">
          选择一个专属目录存放加密容器（AES-256-GCM 流式加密，大文件不占内存）。主密码不可找回——忘记密码等于数据丢失。
        </p>
        <div className="secfile-dir-row">
          <input readOnly value={dir} placeholder="保险柜目录" className="calc-input" />
          <button className="btn-secondary" onClick={async () => setDir((await electronAPI.secfilePickDir()) ?? dir)}>
            <FolderOpen size={14} /> 选择目录
          </button>
        </div>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="主密码（至少 8 位）" />
        <input type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} placeholder="确认主密码" />
        <input
          value={autoLockMin}
          onChange={(e) => setAutoLockMin(e.target.value)}
          placeholder="自动锁定（分钟，1-120）"
        />
        <div className="secvault-form-actions">
          <button onClick={createVault}><ShieldCheck size={14} /> 创建并解锁</button>
          <button className="btn-secondary" onClick={() => setShowImport((v) => !v)}>导入已有保险库</button>
        </div>
        {showImport && <ImportForm
          bundlePath={bundlePath} setBundlePath={setBundlePath}
          importDir={importDir} setImportDir={setImportDir}
          importPw={importPw} setImportPw={setImportPw}
          onImport={doImport}
        />}
      </>
    )
  }

  if (phase === 'locked') {
    return gate(
      <>
        <h4>保险柜已锁定</h4>
        <p className="tool-hint">{status?.dir}</p>
        <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && unlock()} placeholder="主密码" autoFocus />
        <div className="secvault-form-actions">
          <button onClick={unlock}><Unlock size={14} /> 解锁</button>
          <button className="btn-secondary" onClick={() => setShowImport((v) => !v)}>导入已有保险库</button>
        </div>
        {showImport && <ImportForm
          bundlePath={bundlePath} setBundlePath={setBundlePath}
          importDir={importDir} setImportDir={setImportDir}
          importPw={importPw} setImportPw={setImportPw}
          onImport={doImport}
        />}
      </>
    )
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>文件保险柜</h3>
        <div className="tool-actions">
          <button className="btn-secondary" onClick={addViaDialog}><FilePlus2 size={14} /> 添加文件</button>
          <button className="btn-secondary" onClick={exportBundle}>导出保险库</button>
          <button onClick={lock}><Lock size={14} /> 锁定</button>
        </div>
      </div>
      <div className="tool-body">
        <div className="secvault-meta">
          目录：{status?.dir} · 闲置 {status?.autoLockMin} 分钟自动锁定 · 文件名加密存储
        </div>
        {error && <div className="secvault-error">{error}</div>}
        {progress && (
          <div className="secfile-progress">
            <div className="secfile-progress-bar" style={{ width: `${progress.pct}%` }} />
            <span>{progress.name ?? '保险库'} {progress.pct}% <button className="btn-secondary" onClick={() => void electronAPI.secfileCancel()}>取消</button></span>
          </div>
        )}
        <div
          ref={dropRef}
          className={`secfile-drop ${dragOver ? 'active' : ''}`}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => void onDrop(e)}
        >
          拖拽文件到此处加密保存
        </div>
        <div className="secvault-list">
          {status?.entries.length === 0 && <p className="tool-hint">保险柜是空的。添加文件或拖拽到上方区域。</p>}
          {status?.entries.map((e) => (
            <div key={e.id} className="secvault-row">
              <span className="secvault-name" title={e.name}>{e.name}</span>
              <span>{fmtBytes(e.size)}</span>
              <span>{new Date(e.addedAt).toLocaleString()}</span>
              <span className="secvault-actions">
                <button onClick={() => void doPreview(e.id)} title="预览"><Eye size={13} /></button>
                <button onClick={() => void exportFile(e.id)} title="导出解密"><Download size={13} /></button>
                <button className="danger" onClick={() => void removeFile(e.id, e.name)} title="删除"><Trash2 size={13} /></button>
              </span>
            </div>
          ))}
        </div>
        {preview && (
          <div className="secfile-preview-mask" onClick={() => setPreview(null)}>
            <div className="secfile-preview" onClick={(e) => e.stopPropagation()}>
              <div className="secfile-preview-head">
                <span>{preview.name}</span>
                <button className="btn-secondary" onClick={() => setPreview(null)}>关闭</button>
              </div>
              {preview.kind === 'image'
                ? <img src={preview.dataUrl} alt={preview.name} className="secfile-preview-img" />
                : <textarea readOnly value={preview.text} className="secfile-preview-text" />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function ImportForm(props: {
  bundlePath: string; setBundlePath: (v: string) => void
  importDir: string; setImportDir: (v: string) => void
  importPw: string; setImportPw: (v: string) => void
  onImport: () => void
}) {
  return (
    <div className="secfile-import">
      <div className="secfile-dir-row">
        <input readOnly value={props.bundlePath} placeholder="迁移文件（.wbvault）" className="calc-input" />
        <button className="btn-secondary" onClick={async () => props.setBundlePath((await electronAPI.secfilePickBundleFile()) ?? '')}>选择文件</button>
      </div>
      <div className="secfile-dir-row">
        <input readOnly value={props.importDir} placeholder="目标目录（须为空或无保险柜）" className="calc-input" />
        <button className="btn-secondary" onClick={async () => props.setImportDir((await electronAPI.secfilePickDir()) ?? '')}>选择目录</button>
      </div>
      <input type="password" value={props.importPw} onChange={(e) => props.setImportPw(e.target.value)} placeholder="该保险库的主密码" />
      <div className="secvault-form-actions">
        <button onClick={props.onImport}>导入</button>
      </div>
    </div>
  )
}
