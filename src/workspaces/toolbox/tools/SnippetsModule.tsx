import { useState, useEffect } from 'react'
import type { CodeSnippet } from '../../../types/toolbox'
import { electronAPI } from '../utils/electron'

export function SnippetsModule() {
  const [snippets, setSnippets] = useState<CodeSnippet[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingSnippet, setEditingSnippet] = useState<CodeSnippet | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [formData, setFormData] = useState({
    title: '',
    content: '',
    language: 'javascript',
    category: 'default',
    tags: '',
  })

  useEffect(() => {
    ;(async () => {
      const data = await electronAPI.loadData('snippets')
      if (data && typeof data === 'object' && 'categories' in data) {
        const categories = (data as { categories: { snippets: CodeSnippet[] }[] }).categories
        setSnippets(categories.flatMap((c) => c.snippets))
      }
    })()
  }, [])

  const resetForm = () => {
    setFormData({ title: '', content: '', language: 'javascript', category: 'default', tags: '' })
    setShowForm(false)
    setEditingSnippet(null)
  }

  const openEditForm = (snippet: CodeSnippet) => {
    setEditingSnippet(snippet)
    setFormData({
      title: snippet.title,
      content: snippet.content,
      language: snippet.language,
      category: snippet.category || 'default',
      tags: snippet.tags.join(', '),
    })
    setShowForm(true)
  }

  const saveSnippet = async () => {
    if (!formData.title || !formData.content) return

    if (editingSnippet) {
      const updatedSnippets = snippets.map((s) =>
        s.id === editingSnippet.id
          ? {
              ...s,
              title: formData.title,
              content: formData.content,
              language: formData.language,
              category: formData.category,
              tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
              updatedAt: Date.now(),
            }
          : s
      )
      setSnippets(updatedSnippets)
      await electronAPI.saveData('snippets', {
        categories: [{ id: 'default', name: '默认分类', snippets: updatedSnippets }],
      })
    } else {
      const snippet: CodeSnippet = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2),
        title: formData.title,
        content: formData.content,
        language: formData.language,
        category: formData.category,
        tags: formData.tags.split(',').map((t) => t.trim()).filter(Boolean),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      const updated = [...snippets, snippet]
      setSnippets(updated)
      await electronAPI.saveData('snippets', {
        categories: [{ id: 'default', name: '默认分类', snippets: updated }],
      })
    }

    resetForm()
  }

  const deleteSnippet = async (id: string) => {
    const updated = snippets.filter((s) => s.id !== id)
    setSnippets(updated)
    await electronAPI.saveData('snippets', {
      categories: [{ id: 'default', name: '默认分类', snippets: updated }],
    })
  }

  const copySnippet = (content: string) => {
    navigator.clipboard.writeText(content)
  }

  const filteredSnippets = searchQuery
    ? snippets.filter(
        (s) =>
          s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          s.tags.some((t: string) => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : snippets

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>代码片段</h3>
        <div className="module-actions">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="搜索片段..."
            className="search-input"
          />
          <button onClick={() => { resetForm(); setShowForm(true) }} className="btn-secondary">
            新增片段
          </button>
        </div>
      </div>
      <div className="module-body">
        {showForm && (
          <div className="form-panel">
            <h4>{editingSnippet ? '编辑代码片段' : '新增代码片段'}</h4>
            <div className="form-row">
              <label>标题</label>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="片段标题"
              />
            </div>
            <div className="form-row">
              <label>语言</label>
              <select
                value={formData.language}
                onChange={(e) => setFormData({ ...formData, language: e.target.value })}
              >
                <option value="javascript">JavaScript</option>
                <option value="typescript">TypeScript</option>
                <option value="python">Python</option>
                <option value="java">Java</option>
                <option value="go">Go</option>
                <option value="html">HTML</option>
                <option value="css">CSS</option>
                <option value="sql">SQL</option>
                <option value="bash">Bash</option>
                <option value="json">JSON</option>
              </select>
            </div>
            <div className="form-row">
              <label>标签 (逗号分隔)</label>
              <input
                type="text"
                value={formData.tags}
                onChange={(e) => setFormData({ ...formData, tags: e.target.value })}
                placeholder="tag1, tag2"
              />
            </div>
            <div className="form-row">
              <label>代码内容</label>
              <textarea
                value={formData.content}
                onChange={(e) => setFormData({ ...formData, content: e.target.value })}
                placeholder="输入代码内容"
                rows={8}
                className="code-textarea"
              />
            </div>
            <div className="form-actions">
              <button onClick={saveSnippet}>{editingSnippet ? '更新' : '保存'}</button>
              <button onClick={resetForm} className="btn-secondary">
                取消
              </button>
            </div>
          </div>
        )}

        <div className="snippets-list">
          {filteredSnippets.length === 0 && (
            <div className="empty-state">
              <p>{searchQuery ? '没有找到匹配的片段' : '暂无代码片段，点击"新增片段"开始'}</p>
            </div>
          )}
          {filteredSnippets.map((snippet) => (
            <div key={snippet.id} className="snippet-item">
              <div className="snippet-header">
                <div className="snippet-title">
                  <span className="lang-tag">{snippet.language}</span>
                  {snippet.title}
                </div>
                <div className="snippet-actions">
                  <button onClick={() => copySnippet(snippet.content)} className="btn-secondary">
                    复制
                  </button>
                  <button onClick={() => openEditForm(snippet)} className="btn-secondary">
                    编辑
                  </button>
                  <button onClick={() => deleteSnippet(snippet.id)} className="btn-danger">
                    删除
                  </button>
                </div>
              </div>
              <pre className="snippet-content">{snippet.content}</pre>
              {snippet.tags.length > 0 && (
                <div className="snippet-tags">
                  {snippet.tags.map((tag: string, i: number) => (
                    <span key={i} className="tag">
                      {tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
