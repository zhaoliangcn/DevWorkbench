import { useState, useEffect, useRef } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { Search, FileText } from 'lucide-react'

export default function SearchPanel() {
  const [query, setQuery] = useState('')
  const searchNotes = useStore((s) => s.searchNotes)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const inputRef = useRef<HTMLInputElement>(null)

  const results = query.trim() ? searchNotes(query) : []

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  return (
    <div className="search-panel">
      <div className="search-input-wrapper">
        <Search size={14} className="search-icon" />
        <input
          ref={inputRef}
          type="text"
          className="search-input"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索笔记... (Cmd/Ctrl+K)"
        />
      </div>

      <div className="search-results">
        {query.trim() === '' ? (
          <p className="panel-empty-text">输入关键词搜索笔记标题和内容</p>
        ) : results.length === 0 ? (
          <p className="panel-empty-text">未找到匹配的笔记</p>
        ) : (
          results.map((note) => (
            <div
              key={note.id}
              className="search-result-item"
              onClick={() => setActiveNote(note.id)}
            >
              <FileText size={14} />
              <div className="search-result-info">
                <span className="search-result-title">{note.title}</span>
                <span className="search-result-path">{note.path}</span>
              </div>
              {note.tags.length > 0 && (
                <div className="search-result-tags">
                  {note.tags.map((tag) => (
                    <span key={tag} className="tag-badge">
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
