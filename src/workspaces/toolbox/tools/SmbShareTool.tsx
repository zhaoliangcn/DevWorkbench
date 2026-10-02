import { useEffect, useState } from 'react'
import { RefreshCw, FolderOpen, Plus, Trash2, ShieldAlert, CheckCircle2 } from 'lucide-react'
import { electronAPI } from '../utils/electron'
import { parseShareList, suggestName, isHiddenShare } from './pure/smb'
import type { SmbShareRow } from './pure/smb'

/**
 * SMB 共享管理（smb:* 命名空间）：一键创建/删除本机 SMB 共享目录，
 * 服务局域网协作场景（共享 Vault / 项目目录）。跨平台：win32 net share、
 * linux smb.conf（pkexec/sudo）、darwin sharing（sudo）。
 */

interface SmbCheckResult {
  available: boolean
  platform: string
  isAdmin?: boolean
  error?: string
}

interface SmbCreateInput {
  name: string
  path: string
  remark: string
  readonly: boolean
  users: string
}

const EMPTY_FORM: SmbCreateInput = { name: '', path: '', remark: '', readonly: false, users: '' }

export function SmbShareTool() {
  const [check, setCheck] = useState<SmbCheckResult | null>(null)
  const [shares, setShares] = useState<SmbShareRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [form, setForm] = useState<SmbCreateInput>(EMPTY_FORM)
  const [creating, setCreating] = useState(false)
  const [busyName, setBusyName] = useState('')
  const [pendingDelete, setPendingDelete] = useState('')
  const [reloadKey, setReloadKey] = useState(0)
  const [checkKey, setCheckKey] = useState(0)

  // 挂载 / 手动重检测（setState 均在 await 之后，规避级联渲染）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const r = await electronAPI.smbCheck()
      if (cancelled) return
      setCheck(r)
      if (r.available) setLoading(true)
    })()
    return () => {
      cancelled = true
    }
  }, [checkKey])

  // 列表加载：解析由 pure 层完成（可测试）
  useEffect(() => {
    if (!check?.available) return
    let cancelled = false
    ;(async () => {
      setError('')
      const r = await electronAPI.smbList()
      if (cancelled) return
      if (r.success) setShares(parseShareList(r.raw, r.platform))
      else setError(r.error ?? '获取共享列表失败')
      if (!cancelled) setLoading(false)
    })()
    return () => {
      cancelled = true
    }
  }, [check?.available, reloadKey])

  const handleRefresh = () => {
    setLoading(true)
    setReloadKey((k) => k + 1)
  }

  const handleRecheck = () => {
    setCheck(null)
    setCheckKey((k) => k + 1)
  }

  const pickDir = async () => {
    const r = await electronAPI.smbPickDir()
    if (!r.canceled && r.path) {
      setForm((f) => ({ ...f, path: r.path, name: f.name || suggestName(r.path) }))
    }
  }

  const handleCreate = async () => {
    if (!form.name.trim() || !form.path.trim()) {
      setError('共享名与路径必填')
      return
    }
    setCreating(true)
    setError('')
    setNotice('')
    const r = await electronAPI.smbCreate({
      name: form.name.trim(),
      path: form.path.trim(),
      remark: form.remark.trim() || undefined,
      readonly: form.readonly,
      users: form.users.trim() || undefined,
    })
    if (r.success) {
      setForm(EMPTY_FORM)
      setNotice(`共享「${form.name.trim()}」创建成功`)
      setReloadKey((k) => k + 1)
    } else {
      setError(r.error ?? '创建失败')
    }
    setCreating(false)
  }

  const handleDelete = async (name: string) => {
    setBusyName(name)
    setError('')
    setNotice('')
    const r = await electronAPI.smbDelete(name)
    if (r.success) setNotice(`共享「${name}」已删除（实际目录未受影响）`)
    else setError(r.error ?? '删除失败')
    setBusyName('')
    setPendingDelete('')
    setReloadKey((k) => k + 1)
  }

  if (check === null) {
    return (
      <div className="module-container">
        <div className="module-header">
          <h3>SMB 共享管理</h3>
        </div>
        <div className="module-body">
          <p className="tool-hint">检测 SMB 服务环境…</p>
        </div>
      </div>
    )
  }

  if (!check.available) {
    return (
      <div className="module-container">
        <div className="module-header">
          <h3>SMB 共享管理</h3>
        </div>
        <div className="module-body">
          <div className="tool-section">
            <p className="tool-hint">
              <ShieldAlert size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />
              {check.platform === 'linux' && '未安装 Samba，请先安装（apt install samba / dnf install samba）'}
              {check.platform === 'darwin' && '未找到 macOS 共享命令（sharing）'}
              {check.platform === 'win32' && '未检测到 net share 命令'}
              {!['linux', 'darwin', 'win32'].includes(check.platform) && '不支持的平台'}
            </p>
            {check.error && <p className="tool-hint">{check.error}</p>}
            <button onClick={handleRecheck}>重新检测</button>
          </div>
        </div>
      </div>
    )
  }

  const isAdmin = check.isAdmin !== false
  const platform = check.platform

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>SMB 共享管理 · {platformLabel(platform)}</h3>
      </div>
      <div className="module-body">
        {!isAdmin && (
          <p className="smb-admin-warn">
            <ShieldAlert size={13} /> 当前非管理员权限运行，创建/删除共享将失败（Windows 需以管理员身份启动应用）
          </p>
        )}

        <div className="smb-create-panel">
          <h4>
            <Plus size={14} /> 一键创建共享
          </h4>
          <div className="smb-form-row">
            <label>共享名</label>
            <input
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              placeholder="如 shared-proj"
            />
          </div>
          <div className="smb-form-row">
            <label>共享路径</label>
            <input
              value={form.path}
              onChange={(e) => setForm((f) => ({ ...f, path: e.target.value }))}
              placeholder="如 D:\share\shared-proj"
            />
            <button onClick={pickDir} title="浏览目录">
              <FolderOpen size={12} /> 选择
            </button>
          </div>
          <div className="smb-form-row">
            <label>备注</label>
            <input
              value={form.remark}
              onChange={(e) => setForm((f) => ({ ...f, remark: e.target.value }))}
              placeholder="可选"
            />
          </div>
          <div className="smb-form-row">
            <label>访问账户</label>
            <input
              value={form.users}
              onChange={(e) => setForm((f) => ({ ...f, users: e.target.value }))}
              placeholder={
                platform === 'win32'
                  ? '逗号分隔，空 = Everyone'
                  : platform === 'linux'
                    ? 'Samba 用户名（空 = guest）'
                    : 'macOS 不支持账户配置'
              }
              disabled={platform === 'darwin'}
            />
            <label className="smb-checkbox">
              <input
                type="checkbox"
                checked={form.readonly}
                onChange={(e) => setForm((f) => ({ ...f, readonly: e.target.checked }))}
              />
              只读
            </label>
          </div>
          <div className="smb-form-row">
            <button className="smb-primary" onClick={handleCreate} disabled={creating}>
              {creating ? '创建中…' : '创建共享'}
            </button>
          </div>
        </div>

        <div className="smb-list-panel">
          <div className="docker-toolbar">
            <h4>当前共享 ({shares.length})</h4>
            <button onClick={handleRefresh} disabled={loading} title="刷新">
              <RefreshCw size={14} />
            </button>
          </div>

          {error && <p className="docker-error">{error}</p>}
          {notice && <p className="docker-error smb-notice">{notice}</p>}

          <div className="docker-table">
            <div className="docker-row smb-row docker-head">
              <span>共享名</span>
              <span>路径</span>
              <span>操作</span>
            </div>
            {shares.map((s) => (
              <div key={s.name} className="docker-row smb-row">
                <span className="docker-name" title={s.name}>
                  {s.name}
                  {isHiddenShare(s.name) && <span className="smb-badge">系统</span>}
                </span>
                <span className="docker-image" title={s.path}>
                  {s.path || '—'}
                </span>
                <span className="docker-actions">
                  {pendingDelete === s.name ? (
                    <>
                      <button className="danger" disabled={busyName === s.name} onClick={() => handleDelete(s.name)}>
                        确认删除
                      </button>
                      <button onClick={() => setPendingDelete('')}>取消</button>
                    </>
                  ) : (
                    <button
                      className="danger"
                      disabled={busyName === s.name || isHiddenShare(s.name)}
                      title={isHiddenShare(s.name) ? '系统内置共享不可删除' : undefined}
                      onClick={() => setPendingDelete(s.name)}
                    >
                      <Trash2 size={12} /> 删除
                    </button>
                  )}
                </span>
              </div>
            ))}
            {!loading && shares.length === 0 && <p className="tool-hint">暂无共享</p>}
          </div>

          <p className="smb-tip">
            <CheckCircle2 size={12} />
            {platform === 'win32' && '其他机器通过 \\\\本机IP\\共享名 访问（需放行防火墙 445 端口）。'}
            {platform === 'linux' && '其他机器通过 smb://本机IP/共享名 访问；guest 访问需 smb.conf 全局配置 map to guest。'}
            {platform === 'darwin' && '其他机器通过 smb://本机IP/共享名 访问；macOS 共享为目录级开关，账户在系统设置配置。'}
          </p>
        </div>
      </div>
    </div>
  )
}

function platformLabel(p: string): string {
  return p === 'win32' ? 'Windows' : p === 'linux' ? 'Linux (Samba)' : p === 'darwin' ? 'macOS' : p
}
