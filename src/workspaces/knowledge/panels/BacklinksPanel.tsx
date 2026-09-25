import { useStore } from '../../../store/knowledgeStore'
import { Link2, ArrowLeftRight } from 'lucide-react'

export default function BacklinksPanel() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const getBacklinks = useStore((s) => s.getBacklinks)
  const getOutlinks = useStore((s) => s.getOutlinks)
  const setActiveNote = useStore((s) => s.setActiveNote)

  if (!activeNoteId) {
    return (
      <div className="panel-empty">
        <p>请先选择一个笔记</p>
      </div>
    )
  }

  const backlinks = getBacklinks(activeNoteId)
  const outlinks = getOutlinks(activeNoteId)

  return (
    <div className="backlinks-panel">
      <div className="panel-section">
        <h3 className="panel-section-title">
          <ArrowLeftRight size={14} /> 反向链接 ({backlinks.length})
        </h3>
        {backlinks.length === 0 ? (
          <p className="panel-empty-text">没有笔记引用当前笔记</p>
        ) : (
          <div className="link-list">
            {backlinks.map((link) => {
              const sourceNote = notes[link.source]
              if (!sourceNote) return null
              return (
                <div
                  key={link.source}
                  className="link-item"
                  onClick={() => setActiveNote(link.source)}
                >
                  <Link2 size={14} />
                  <span>{sourceNote.title}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="panel-section">
        <h3 className="panel-section-title">
          <Link2 size={14} /> 出链 ({outlinks.length})
        </h3>
        {outlinks.length === 0 ? (
          <p className="panel-empty-text">当前笔记没有引用其他笔记</p>
        ) : (
          <div className="link-list">
            {outlinks.map((link) => {
              const targetNote = notes[link.target]
              if (!targetNote) return null
              return (
                <div
                  key={link.target}
                  className="link-item"
                  onClick={() => setActiveNote(link.target)}
                >
                  <Link2 size={14} />
                  <span>{targetNote.title}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
