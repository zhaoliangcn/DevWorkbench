import { useState } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { Tag, FileText } from 'lucide-react'

export default function TagsPanel() {
  const getAllTags = useStore((s) => s.getAllTags)
  const getNotesByTag = useStore((s) => s.getNotesByTag)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const [selectedTag, setSelectedTag] = useState<string | null>(null)

  const allTags = getAllTags()
  const taggedNotes = selectedTag ? getNotesByTag(selectedTag) : []

  return (
    <div className="tags-panel">
      <div className="panel-section">
        <h3 className="panel-section-title">
          <Tag size={14} /> 标签 ({allTags.length})
        </h3>
        {allTags.length === 0 ? (
          <p className="panel-empty-text">暂无标签，在笔记中使用 #标签名 创建标签</p>
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
