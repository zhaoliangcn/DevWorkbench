import { useEffect, useState } from 'react'
import { Copy, Eye, EyeOff, KeyRound, Lock, Pencil, Plus, Trash2, Unlock } from 'lucide-react'
import { electronAPI } from '../utils/electron'

type Phase = 'loading' | 'uninitialized' | 'locked' | 'unlocked'

interface EntryMeta {
  id: string
  name: string
  kind: string
  createdAt: string
}

const KIND_LABELS: Record<string, string> = {
  ssh: 'SSH',
  http: 'HTTP',
  db: 'DB',
  other: '其他',
}

const KINDS = ['ssh', 'http', 'db', 'other'] as const

/** 未初始化：设置主密码 */
function SetupForm({ onDone }: { onDone: (pw: string) => void }) {
  const [pw, setPw] = useState('')
  const [pw2, setPw2] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    if (pw !== pw2) {
      setError('两次输入的密码不一致')
      return
    }
    const r = await electronAPI.vaultInit(pw)
    if (!r.success) {
      setError(r.error ?? '初始化失败')
      return
    }
    onDone(pw)
  }

  return (
    <div className="secvault-gate">
      <KeyRound size={28} />
      <h4>创建凭据保险库</h4>
      <p className="tool-hint">
        主密码用于加密存储（AES-256-GCM），不可找回。凭据值密文落盘，名称/类型明文展示。
      </p>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="主密码（至少 8 位）"
      />
      <input
        type="password"
        value={pw2}
        onChange={(e) => setPw2(e.target.value)}
        placeholder="确认主密码"
      />
      {error && <p className="secvault-error">{error}</p>}
      <button onClick={submit} disabled={pw.length < 8 || pw !== pw2}>
        创建并解锁
      </button>
    </div>
  )
}

/** 锁定：输入主密码解锁 */
function UnlockForm({ onUnlock }: { onUnlock: (pw: string) => void }) {
  const [pw, setPw] = useState('')
  const [error, setError] = useState('')

  const submit = async () => {
    setError('')
    const r = await electronAPI.vaultVerify(pw)
    if (r.success && r.verified) {
      onUnlock(pw)
    } else {
      setError('主密码错误')
    }
  }

  return (
    <div className="secvault-gate">
      <Lock size={28} />
      <h4>保险库已锁定</h4>
      <input
        type="password"
        value={pw}
        onChange={(e) => setPw(e.target.value)}
        placeholder="主密码"
        onKeyDown={(e) => e.key === 'Enter' && submit()}
      />
      {error && <p className="secvault-error">{error}</p>}
      <button onClick={submit}>解锁</button>
    </div>
  )
}

export function VaultTool() {
  const [phase, setPhase] = useState<Phase>('loading')
  const [masterPw, setMasterPw] = useState('')
  const [entries, setEntries] = useState<EntryMeta[]>([])
  const [error, setError] = useState('')

  // 表单态（新增/编辑共用）
  const [editingId, setEditingId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [kind, setKind] = useState<(typeof KINDS)[number]>('other')
  const [value, setValue] = useState('')

  // 明文查看（每条目独立，不常驻内存展示）
  const [revealed, setRevealed] = useState<Record<string, string>>({})

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const s = await electronAPI.vaultStatus()
      if (cancelled) return
      setPhase(s.initialized ? 'locked' : 'uninitialized')
    }
    load()
    return () => {
      cancelled = true
    }
  }, [])

  const loadEntries = async (pw: string) => {
    const r = await electronAPI.vaultList(pw)
    if (r.success) {
      setEntries(r.entries)
      setError('')
    } else {
      setError(r.error ?? '读取失败')
    }
  }

  const unlock = async (pw: string) => {
    setMasterPw(pw)
    setPhase('unlocked')
    await loadEntries(pw)
  }

  const openCreate = () => {
    setEditingId(null)
    setName('')
    setKind('other')
    setValue('')
  }

  const openEdit = async (e: EntryMeta) => {
    setEditingId(e.id)
    setName(e.name)
    setKind(KINDS.includes(e.kind as never) ? (e.kind as (typeof KINDS)[number]) : 'other')
    const r = await electronAPI.vaultGet(masterPw, e.id)
    setValue(r.success ? r.value : '')
  }

  const saveEntry = async () => {
    setError('')
    const r = await electronAPI.vaultPut(masterPw, {
      id: editingId ?? undefined,
      name,
      kind,
      value,
    })
    if (!r.success) {
      setError(r.error ?? '保存失败')
      return
    }
    openCreate() // 清空表单
    await loadEntries(masterPw)
  }

  const reveal = async (id: string) => {
    if (revealed[id] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      return
    }
    const r = await electronAPI.vaultGet(masterPw, id)
    if (r.success) {
      setRevealed((prev) => ({ ...prev, [id]: r.value }))
    } else {
      setError(r.error ?? '解密失败')
    }
  }

  const copyValue = async (id: string) => {
    const r = await electronAPI.vaultGet(masterPw, id)
    if (r.success) await navigator.clipboard.writeText(r.value)
  }

  const removeEntry = async (id: string) => {
    const r = await electronAPI.vaultDelete(masterPw, id)
    if (r.success) {
      setRevealed((prev) => {
        const next = { ...prev }
        delete next[id]
        return next
      })
      await loadEntries(masterPw)
    } else {
      setError(r.error ?? '删除失败')
    }
  }

  const lock = () => {
    setMasterPw('')
    setEntries([])
    setRevealed({})
    setPhase('locked')
  }

  if (phase === 'loading') {
    return (
      <div className="module-container">
        <div className="module-header">
          <h3>凭据保险库</h3>
        </div>
        <div className="module-body">
          <p className="tool-hint">加载中…</p>
        </div>
      </div>
    )
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>凭据保险库</h3>
      </div>
      <div className="module-body">
        {phase === 'uninitialized' && (
          <SetupForm onDone={unlock} />
        )}
        {phase === 'locked' && <UnlockForm onUnlock={unlock} />}
        {phase === 'unlocked' && (
          <>
            <div className="secvault-toolbar">
              <span className="secvault-meta">
                {entries.length} 条凭据 · <Unlock size={11} /> 已解锁
              </span>
              <button onClick={openCreate} title="新增凭据">
                <Plus size={13} /> 新增
              </button>
              <button onClick={lock} title="立即锁定（清空内存中的主密码）">
                <Lock size={13} /> 锁定
              </button>
            </div>

            {error && <p className="secvault-error">{error}</p>}

            <div className="secvault-form">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="名称（如 prod-db / github-deploy-key）" />
              <select value={kind} onChange={(e) => setKind(e.target.value as (typeof KINDS)[number])}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {KIND_LABELS[k]}
                  </option>
                ))}
              </select>
              <textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="凭据值：私钥 / token / 连接串（支持多行）"
                rows={3}
              />
              <div className="secvault-form-actions">
                <button onClick={saveEntry} disabled={!name.trim()}>
                  {editingId ? (
                    <>
                      <Pencil size={12} /> 更新
                    </>
                  ) : (
                    <>
                      <Plus size={12} /> 保存
                    </>
                  )}
                </button>
                {editingId && <button onClick={openCreate}>取消编辑</button>}
              </div>
            </div>

            <div className="secvault-list">
              {entries.map((e) => (
                <div key={e.id} className="secvault-row">
                  <span className="secvault-kind">{KIND_LABELS[e.kind] ?? e.kind}</span>
                  <span className="secvault-name" title={e.createdAt}>{e.name}</span>
                  <span className="secvault-value">
                    {revealed[e.id] !== undefined ? (
                      revealed[e.id] || '""'
                    ) : (
                      '••••••••'
                    )}
                  </span>
                  <span className="secvault-actions">
                    <button onClick={() => reveal(e.id)} title={revealed[e.id] !== undefined ? '隐藏' : '查看明文'}>
                      {revealed[e.id] !== undefined ? <EyeOff size={12} /> : <Eye size={12} />}
                    </button>
                    <button onClick={() => copyValue(e.id)} title="复制到剪贴板">
                      <Copy size={12} />
                    </button>
                    <button onClick={() => openEdit(e)} title="编辑">
                      <Pencil size={12} />
                    </button>
                    <button
                      className="danger"
                      onClick={() => removeEntry(e.id)}
                      title="删除（不可恢复）"
                    >
                      <Trash2 size={12} />
                    </button>
                  </span>
                </div>
              ))}
              {entries.length === 0 && <p className="tool-hint">暂无凭据，用上方表单新增第一条</p>}
            </div>
            <p className="tool-hint">
              存储位置：userData/credentials-vault.json（值 AES-256-GCM 密文）· 切换工具自动锁定
            </p>
          </>
        )}
      </div>
    </div>
  )
}
