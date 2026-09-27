import { useMemo } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { extractHeadings } from '../utils/outline'
import { List } from 'lucide-react'

/** 大纲面板（附录 E E.3.5）：标题层级列表，点击滚动预览区到锚点 */
export default function OutlinePanel() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const activeNote = activeNoteId ? notes[activeNoteId] : null

  const headings = useMemo(
    () => (activeNote ? extractHeadings(activeNote.content) : []),
    [activeNote]
  )

  return (
    <div className="outline-panel">
      <div className="panel-section">
        <h3 className="panel-section-title">
          <List size={14} /> 大纲 ({headings.length})
        </h3>
        {headings.length === 0 ? (
          <p className="panel-empty-text">暂无标题，使用 # 标题 语法生成大纲</p>
        ) : (
          <div className="outline-list">
            {headings.map((h) => (
              <button
                key={h.id}
                type="button"
                className="outline-item"
                style={{ paddingLeft: (h.level - 1) * 14 + 8 }}
                onClick={() =>
                  window.dispatchEvent(new CustomEvent('knowledge:outline-jump', { detail: h.id }))
                }
                title={h.text}
              >
                <span className="outline-level">H{h.level}</span>
                <span className="outline-text">{h.text}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
