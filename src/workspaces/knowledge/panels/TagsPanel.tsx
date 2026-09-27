import { useMemo, useState } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { Tag, FileText } from 'lucide-react'

export default function TagsPanel() {
  const notes = useStore((s) => s.notes)
  const getAllTags = useStore((s) => s.getAllTags)
  const getNotesByTag = useStore((s) => s.getNotesByTag)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const allTags = getAllTags()
  const taggedNotes = selectedTag ? getNotesByTag(selectedTag) : []

  // 标签 → 笔记计数（附录 E E.3.3），随 notes 派生缓存
  const tagCounts = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const note of Object.values(notes)) {
      for (const tag of note.tags) {
        counts[tag] = (counts[tag] || 0) + 1
      }
    }
    return counts
  }, [notes])

  return (
    <div className="tags-panel">
      <div className="panel-section">
        <h3 className="panel-section-title">
          <Tag size={14} /> 标签 ({allTags.length})
        </h3>
        {allTags.length === 0 ? (
          <p className="panel-empty-text">暂无标签，在笔记中使用 #标签名 或 frontmatter tags 创建标签</p>
        ) : (
          <div className="tags-cloud">
            {allTags.map((tag) => (
              <span
                key={tag}
                className={`tag-chip ${selectedTag === tag ? 'active' : ''}`}
                onClick={() =>
                  setSelectedTag(selectedTag === tag ? null : tag)
                }
              >
                #{tag}
                <span className="tag-chip-count">{tagCounts[tag] ?? 0}</span>
              </span>
            ))}
          </div>
        )}
      </div>

      {selectedTag && (
        <div className="panel-section">
          <h3 className="panel-section-title">
            <FileText size={14} /> 包含 #{selectedTag} 的笔记 ({taggedNotes.length})
          </h3>
          <div className="link-list">
            {taggedNotes.map((note) => (
              <div
                key={note.id}
                className="link-item"
                onClick={() => setActiveNote(note.id)}
              >
                <FileText size={14} />
                <span>{note.title}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
