import { useState, useEffect } from 'react'
import { electronAPI } from '../utils/electron'
import type { NoteCipher } from './pure/notesCrypto'
import { encryptText, decryptText } from './pure/notesCrypto'
import type { Note, MergeStrategy } from './pure/notes'
import { buildNotesExport, validateNotesImport, mergeNotes } from './pure/notes'

const noteColors = ['#2d2d2d', '#1a3a2a', '#2a1a3a', '#3a2a1a', '#1a2a3a', '#3a1a2a']
const noteCategories = ['默认', '灵感', '想法', '待办', '学习', '其他']

interface SessionUnlock {
  password: string
  plain: string
}

interface PendingImport {
  notes: Note[]
  total: number
  encrypted: number
}

export function NotesModule() {
  const [notes, setNotes] = useState<Note[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingNote, setEditingNote] = useState<Note | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedCategory, setSelectedCategory] = useState('全部')
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    category: '默认',
    tags: '',
    color: noteColors[0],
    encrypted: false,
    password: '',
  })
  // 解锁状态仅存本会话内存（密码+明文），重启应用即失效
  const [unlocked, setUnlocked] = useState<Record<string, SessionUnlock>>({})
  const [importing, setImporting] = useState(false)
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null)
  const [importStrategy, setImportStrategy] = useState<MergeStrategy>('skip')
  const [importResult, setImportResult] = useState<string | null>(null)
  const [importError, setImportError] = useState(false)

  useEffect(() => {
    ;(async () => {
      const data = await electronAPI.loadData('notes')
      if (data && typeof data === 'object' && 'notes' in data) {
        setNotes((data as { notes: Note[] }).notes)
      }
    })()
  }, [])

  const persist = async (next: Note[]) => {
    setNotes(next)
    await electronAPI.saveData('notes', { notes: next })
  }

  const resetForm = () => {
    setFormData({ title: '', content: '', category: '默认', tags: '', color: noteColors[0], encrypted: false, password: '' })
    setShowForm(false)
    setEditingNote(null)
  }

  const openEditForm = (note: Note) => {
    setEditingNote(note)
    setFormData({
      title: note.title,
      content: note.encrypted ? unlocked[note.id]?.plain ?? '' : note.content,
      category: note.category,
      tags: note.tags.join(', '),
      color: note.color || noteColors[0],
      encrypted: note.encrypted ?? false,
      password: '',
    })
    setShowForm(true)
  }

  const saveNote = async () => {
    const lockedMetaOnly = !!editingNote && editingNote.encrypted === true && !unlocked[editingNote.id]
    if (!lockedMetaOnly && !formData.title && !formData.content) return

    if (!editingNote) {
      // 新建
      let note: Note = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        title: formData.title || '无标题',
        content: formData.content,
        category: formData.category,
        tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        color: formData.color,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        pinned: false,
      }
      if (formData.encrypted) {
        if (!formData.password || !formData.content) {
          alert('加密保存需要填写内容和密码')
          return
        }
        const cipher = await encryptText(formData.password, formData.content)
        note = { ...note, content: '', encrypted: true, cipher }
      }
      await persist([note, ...notes])
      resetForm()
      return
    }

    // 编辑
    const wasEnc = editingNote.encrypted === true
    const prev = unlocked[editingNote.id]

    if (formData.encrypted) {
      if (wasEnc && !prev) {
        if (!formData.password) {
          // 未解锁且未输新密码：仅更新标题/分类等元数据，保留原密文
          await persist(
            notes.map((n) =>
              n.id === editingNote.id
                ? {
                    ...n,
                    title: formData.title || '无标题',
                    category: formData.category,
                    tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
                    color: formData.color,
                    updatedAt: Date.now(),
                  }
                : n,
            ),
          )
          resetForm()
          return
        }
        alert('请先解锁笔记后再修改密码或内容')
        return
      }
      const password = formData.password || prev!.password
      if (!formData.content) {
        alert('加密保存需要填写内容')
        return
      }
      const cipher = await encryptText(password, formData.content)
      const targetId = editingNote.id
      await persist(
        notes.map((n) =>
          n.id === targetId
            ? {
                ...n,
                title: formData.title || '无标题',
                content: '',
                category: formData.category,
                tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
                color: formData.color,
                updatedAt: Date.now(),
                encrypted: true,
                cipher,
              }
            : n,
        ),
      )
      resetForm()
      return
    }

    // 取消加密 → 明文保存
    if (wasEnc && !prev) {
      alert('请先解锁该笔记，再取消加密')
      return
    }
    const targetId = editingNote.id
    await persist(
      notes.map((n) => {
        if (n.id !== targetId) return n
        const next: Note = {
          ...n,
          title: formData.title || '无标题',
          content: formData.content,
          category: formData.category,
          tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
          color: formData.color,
          updatedAt: Date.now(),
        }
        delete next.encrypted
        delete next.cipher
        return next
      }),
    )
    resetForm()
  }

  const deleteNote = async (id: string) => {
    if (!confirm('确定删除该笔记？')) return
    await persist(notes.filter((n) => n.id !== id))
    setUnlocked((u) => {
      const next = { ...u }
      delete next[id]
      return next
    })
  }

  const togglePin = async (id: string) => {
    await persist(notes.map((n) => (n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n)))
  }

  const handleUnlocked = (id: string, password: string, plain: string) => {
    setUnlocked((u) => ({ ...u, [id]: { password, plain } }))
  }

  const relock = (id: string) => {
    setUnlocked((u) => {
      const next = { ...u }
      delete next[id]
      return next
    })
  }

  const copyNote = (note: Note) => {
    const text = note.encrypted ? unlocked[note.id]?.plain : note.content
    if (!text) {
      alert('请先解锁后再复制')
      return
    }
    navigator.clipboard.writeText(text)
  }

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp)
    const now = new Date()
    const diff = now.getTime() - date.getTime()

    if (diff < 60000) return '刚刚'
    if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`
    if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`
    if (diff < 604800000) return `${Math.floor(diff / 86400000)} 天前`

    return date.toLocaleDateString('zh-CN')
  }

  const exportNotes = async () => {
    if (notes.length === 0) {
      alert('暂无笔记可导出')
      return
    }
    const json = JSON.stringify(buildNotesExport(notes), null, 2)
    const date = new Date().toISOString().slice(0, 10)
    const res = await electronAPI.saveTextAs(`notes-export-${date}.json`, json, 'JSON 文件', 'json')
    if (!res.canceled && res.success) {
      alert(`已导出 ${notes.length} 条笔记（加密笔记仅含密文）`)
    }
  }

  const startImport = async () => {
    setImportResult(null)
    setImportError(false)
    const res = await electronAPI.openTextFile('JSON 文件', ['json'])
    if (res.canceled) return
    if (!res.success) {
      setImportResult(res.error || '读取文件失败')
      setImportError(true)
      return
    }
    const v = validateNotesImport(res.content)
    if (!v.ok || !v.notes) {
      setImportResult(v.error || '文件格式不符')
      setImportError(true)
      return
    }
    setPendingImport({ notes: v.notes, total: v.total ?? v.notes.length, encrypted: v.encrypted ?? 0 })
  }

  const confirmImport = async () => {
    if (!pendingImport) return
    const { merged, added, updated } = mergeNotes(notes, pendingImport.notes, importStrategy)
    await persist(merged)
    setImportResult(`导入完成：新增 ${added} 条，更新 ${updated} 条`)
    setImportError(false)
    setPendingImport(null)
  }

  const filteredNotes = notes
    .filter((n) => {
      const matchesSearch =
        !searchQuery ||
        n.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
        n.tags.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()))
      const matchesCategory = selectedCategory === '全部' || n.category === selectedCategory
      return matchesSearch && matchesCategory
    })
    .sort((a, b) => {
      if (a.pinned && !b.pinned) return -1
      if (!a.pinned && b.pinned) return 1
      return b.updatedAt - a.updatedAt
    })

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>随手记</h3>
        <div className="module-actions">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索笔记..."
            className="search-input"
          />
          <button onClick={() => { setImporting(true); setImportResult(null); setImportError(false) }} className="btn-secondary" title="从 JSON 文件批量导入">
            导入
          </button>
          <button onClick={exportNotes} className="btn-secondary" title="导出全部笔记（加密笔记仅导出密文）">
            导出
          </button>
          <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-secondary">
            新建笔记
          </button>
        </div>
      </div>
      <div className="module-body">
        {showForm && (
          <div className="form-panel">
            <h4>{editingNote ? '编辑笔记' : '新建笔记'}</h4>
            <div className="form-row">
              <label>标题</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="笔记标题（可选）"
              />
            </div>
            <div className="form-row">
              <label>分类</label>
              <select
                value={formData.category}
                onChange={(e) => setFormData({ ...formData, category: e.target.value })}
              >
                {noteCategories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <label>标签 (逗号分隔)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="标签1, 标签2"
              />
            </div>
            <div className="form-row">
              <label>颜色标记</label>
              <div className="color-picker">
                {noteColors.map((color) => (
                  <button
                    key={color}
                    className={`color-option ${formData.color === color ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => setFormData({ ...formData, color })}
                  />
                ))}
              </div>
            </div>
            <div className="form-row">
              <label>内容</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder={
                  editingNote?.encrypted && !unlocked[editingNote.id]
                    ? '已加密笔记：解锁后才能编辑内容'
                    : '记录你的想法、灵感、创意...'
                }
                rows={6}
              />
            </div>
            <div className="form-row">
              <label>
                <input
                  type="checkbox"
                  checked={formData.encrypted}
                  onChange={(e) => setFormData({ ...formData, encrypted: e.target.checked })}
                />
                {' '}加密保存（AES-256-GCM，标题/分类/标签保持明文可检索）
              </label>
            </div>
            {formData.encrypted && (
              <div className="form-row">
                <label>加密密码</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  placeholder={editingNote?.encrypted && unlocked[editingNote.id] ? '留空则沿用解锁密码' : '查看该笔记时需输入此密码'}
                  autoComplete="new-password"
                />
              </div>
            )}
            <div className="form-actions">
              <button onClick={saveNote}>{editingNote ? '更新' : '保存'}</button>
              <button onClick={resetForm} className="btn-secondary">
                取消
              </button>
            </div>
          </div>
        )}

        {importing && (
          <div className="notes-import-panel">
            <h4>批量导入</h4>
            <p className="tool-hint">选择 JSON 备份文件；已存在的笔记（按 ID 判断）可跳过或覆盖。</p>
            <div className="import-strategies">
              <button
                className={`import-strategy ${importStrategy === 'skip' ? 'active' : ''}`}
                onClick={() => setImportStrategy('skip')}
              >
                跳过重复
              </button>
              <button
                className={`import-strategy ${importStrategy === 'overwrite' ? 'active' : ''}`}
                onClick={() => setImportStrategy('overwrite')}
              >
                覆盖重复
              </button>
            </div>
            {pendingImport ? (
              <>
                <p className="tool-hint">
                  已解析 {pendingImport.total} 条笔记
                  {pendingImport.encrypted > 0 ? `（含 ${pendingImport.encrypted} 条加密，导入后仍需密码查看）` : ''}。
                </p>
                <div className="form-actions">
                  <button onClick={confirmImport}>开始导入</button>
                  <button onClick={() => setPendingImport(null)} className="btn-secondary">重新选择</button>
                </div>
              </>
            ) : (
              <div className="form-actions">
                <button onClick={startImport}>选择 JSON 文件</button>
                <button onClick={() => { setImporting(false); setImportResult(null) }} className="btn-secondary">关闭</button>
              </div>
            )}
            {importResult && (
              <p className={`import-result ${importError ? 'error' : ''}`}>{importResult}</p>
            )}
          </div>
        )}

        <div className="notes-filters">
          <div className="category-tabs">
            {['全部', ...noteCategories].map((cat) => (
              <button
                key={cat}
                className={`category-tab ${selectedCategory === cat ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat)}
              >
                {cat}
              </button>
            ))}
          </div>
          <span className="notes-count">共 {filteredNotes.length} 条</span>
        </div>

        <div className="notes-list">
          {filteredNotes.length === 0 && (
            <div className="empty-state">
              <p>{searchQuery ? '没有找到匹配的笔记' : '暂无笔记，点击"新建笔记"开始记录'}</p>
            </div>
          )}
          {filteredNotes.map((note) => (
            <div
              key={note.id}
              className="note-item"
              style={{ borderLeft: `4px solid ${note.color || noteColors[0]}` }}
            >
              <div className="note-header">
                <div className="note-title-row">
                  {note.pinned && <span className="pin-icon">📌</span>}
                  {note.encrypted && <span title="加密笔记">🔒</span>}
                  <span className="note-title">{note.title}</span>
                  <span className="note-category">{note.category}</span>
                </div>
                <div className="note-actions">
                  <button onClick={() => togglePin(note.id)} className="btn-icon" title={note.pinned ? '取消置顶' : '置顶'}>
                    {note.pinned ? '📌' : '📍'}
                  </button>
                  <button onClick={() => copyNote(note)} className="btn-icon" title="复制">
                    📋
                  </button>
                  <button onClick={() => openEditForm(note)} className="btn-icon" title="编辑">
                    ✏️
                  </button>
                  <button onClick={() => deleteNote(note.id)} className="btn-icon btn-danger-icon" title="删除">
                    🗑️
                  </button>
                </div>
              </div>
              {note.encrypted && note.cipher ? (
                unlocked[note.id] ? (
                  <>
                    <div className="note-unlock-row">
                      <span className="tool-hint">🔓 已解锁（仅本次会话有效）</span>
                      <button className="btn-icon" onClick={() => relock(note.id)} title="重新锁定">
                        🔒
                      </button>
                    </div>
                    <div className="note-content">{unlocked[note.id].plain}</div>
                  </>
                ) : (
                  <UnlockForm
                    cipher={note.cipher}
                    onUnlocked={(password, plain) => handleUnlocked(note.id, password, plain)}
                  />
                )
              ) : (
                <div className="note-content">{note.content}</div>
              )}
              <div className="note-footer">
                {note.tags.length > 0 && (
                  <div className="note-tags">
                    {note.tags.map((tag, i) => (
                      <span key={i} className="tag">{tag}</span>
                    ))}
                  </div>
                )}
                <span className="note-time">{formatTime(note.updatedAt)}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

/** 锁定笔记的解锁行：输入密码 → 解密 → 回调存入会话内存 */
function UnlockForm({
  cipher,
  onUnlocked,
}: {
  cipher: NoteCipher
  onUnlocked: (password: string, plain: string) => void
}) {
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const tryUnlock = async () => {
    if (!password) return
    try {
      const plain = await decryptText(password, cipher)
      onUnlocked(password, plain)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <div>
      <button className="note-locked-content" onClick={tryUnlock} disabled={!password}>
        🔒 加密笔记 —— 输入密码后点击查看
      </button>
      <div className="note-unlock-row">
        <input
          type="password"
          value={password}
          onChange={(e) => { setPassword(e.target.value); setError('') }}
          onKeyDown={(e) => e.key === 'Enter' && tryUnlock()}
          placeholder="输入密码"
          autoComplete="off"
        />
        <button onClick={tryUnlock}>解锁</button>
      </div>
      {error && <p className="import-result error">{error}</p>}
    </div>
  )
}
