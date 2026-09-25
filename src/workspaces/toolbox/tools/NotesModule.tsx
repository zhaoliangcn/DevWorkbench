import { useState, useEffect } from 'react'
import { electronAPI } from '../utils/electron'

interface Note {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  createdAt: number
  updatedAt: number
  pinned: boolean
  color: string
}

const noteColors = ['#2d2d2d', '#1a3a2a', '#2a1a3a', '#3a2a1a', '#1a2a3a', '#3a1a2a']
const noteCategories = ['默认', '灵感', '想法', '待办', '学习', '其他']

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
  })

  useEffect(() => {
    ;(async () => {
      const data = await electronAPI.loadData('notes')
      if (data && typeof data === 'object' && 'notes' in data) {
        setNotes((data as { notes: Note[] }).notes)
      }
    })()
  }, [])

  const resetForm = () => {
    setFormData({ title: '', content: '', category: '默认', tags: '', color: noteColors[0] })
    setShowForm(false)
    setEditingNote(null)
  }

  const openEditForm = (note: Note) => {
    setEditingNote(note)
    setFormData({
      title: note.title,
      content: note.content,
      category: note.category,
      tags: note.tags.join(', '),
      color: note.color || noteColors[0],
    })
    setShowForm(true)
  }

  const saveNote = async () => {
    if (!formData.title && !formData.content) return

    if (editingNote) {
      const updatedNotes = notes.map((n) =>
        n.id === editingNote.id
          ? {
              ...n,
              title: formData.title || '无标题',
              content: formData.content,
              category: formData.category,
              tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
              color: formData.color,
              updatedAt: Date.now(),
            }
          : n
      )
      setNotes(updatedNotes)
      await electronAPI.saveData('notes', { notes: updatedNotes })
    } else {
      const note: Note = {
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
      const updated = [note, ...notes]
      setNotes(updated)
      await electronAPI.saveData('notes', { notes: updated })
    }

    resetForm()
  }

  const deleteNote = async (id: string) => {
    const updated = notes.filter((n) => n.id !== id)
    setNotes(updated)
    await electronAPI.saveData('notes', { notes: updated })
  }

  const togglePin = async (id: string) => {
    const updated = notes.map((n) =>
      n.id === id ? { ...n, pinned: !n.pinned, updatedAt: Date.now() } : n
    )
    setNotes(updated)
    await electronAPI.saveData('notes', { notes: updated })
  }

  const copyNote = (content: string) => {
    navigator.clipboard.writeText(content)
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
                placeholder="记录你的想法、灵感、创意..."
                rows={6}
              />
            </div>
            <div className="form-actions">
              <button onClick={saveNote}>{editingNote ? '更新' : '保存'}</button>
              <button onClick={resetForm} className="btn-secondary">
                取消
              </button>
            </div>
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
                  <span className="note-title">{note.title}</span>
                  <span className="note-category">{note.category}</span>
                </div>
                <div className="note-actions">
                  <button onClick={() => togglePin(note.id)} className="btn-icon" title={note.pinned ? '取消置顶' : '置顶'}>
                    {note.pinned ? '📌' : '📍'}
                  </button>
                  <button onClick={() => copyNote(note.content)} className="btn-icon" title="复制">
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
              <div className="note-content">{note.content}</div>
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
