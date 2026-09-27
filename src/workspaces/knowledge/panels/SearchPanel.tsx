import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { Search, FileText } from 'lucide-react'

/** 命中片段高亮：按 query 切分文本并 <mark> 标记（大小写不敏感） */
function Highlight({ text, query }: { text: string; query: string }) {
  const q = query.trim()
  if (!q) return <>{text}</>
  const parts: ReactNode[] = []
  const lower = text.toLowerCase()
  const ql = q.toLowerCase()
  let i = 0
  let k: number
  while ((k = lower.indexOf(ql, i)) !== -1) {
    if (k > i) parts.push(text.slice(i, k))
    parts.push(<mark key={k}>{text.slice(k, k + q.length)}</mark>)
    i = k + q.length
  }
  parts.push(text.slice(i))
  return <>{parts}</>
}

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
          results.map((hit) => {
            const note = hit.note
            return (
              <div
                key={note.id}
                className="search-result-item"
                onClick={() => setActiveNote(note.id)}
              >
                <FileText size={14} />
                <div className="search-result-info">
                  <span className="search-result-title">
                    <Highlight text={note.title} query={query} />
                  </span>
                  {hit.snippet && (
                    <span className="search-result-snippet">
                      <Highlight text={hit.snippet} query={query} />
                    </span>
                  )}
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
            )
          })
        )}
      </div>
    </div>
  )
}
