import { useStore } from '../../../store/knowledgeStore'
import { Link2, ArrowLeftRight, CirclePlus, MessageSquareQuote } from 'lucide-react'
import { wrapFirstUnlinkedMention } from '../utils/markdown'

export default function BacklinksPanel() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const getBacklinks = useStore((s) => s.getBacklinks)
  const getOutlinks = useStore((s) => s.getOutlinks)
  const getUnresolved = useStore((s) => s.getUnresolved)
  const getUnlinkedMentions = useStore((s) => s.getUnlinkedMentions)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const createNoteWithTitle = useStore((s) => s.createNoteWithTitle)
  const updateNoteContent = useStore((s) => s.updateNoteContent)

  if (!activeNoteId) {
    return (
      <div className="panel-empty">
        <p>请先选择一个笔记</p>
      </div>
    )
  }

  const activeNote = notes[activeNoteId]
  const backlinks = getBacklinks(activeNoteId)
  const outlinks = getOutlinks(activeNoteId)
  const unresolved = getUnresolved(activeNoteId)
  const mentions = getUnlinkedMentions(activeNoteId)

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

      {/* 未解析出链（附录 E E.3.1）：点击一键创建对应笔记 */}
      {unresolved.length > 0 && (
        <div className="panel-section">
          <h3 className="panel-section-title">
            <CirclePlus size={14} /> 未解析出链 ({unresolved.length})
          </h3>
          <div className="link-list">
            {unresolved.map((title) => (
              <div
                key={title}
                className="link-item link-item--unresolved"
                onClick={() => createNoteWithTitle(title)}
                title="点击创建该笔记"
              >
                <CirclePlus size={14} />
                <span>{title}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 提及未链接（附录 E E.3.1）：一键把首个纯文本提及包裹为 [[ ]] */}
      {mentions.length > 0 && activeNote && (
        <div className="panel-section">
          <h3 className="panel-section-title">
            <MessageSquareQuote size={14} /> 提及未链接 ({mentions.length})
          </h3>
          <div className="link-list">
            {mentions.map((m) => (
              <div key={m.id} className="link-item">
                <MessageSquareQuote size={14} />
                <span>{m.title}</span>
                <button
                  className="link-item-action"
                  onClick={() => {
                    const next = wrapFirstUnlinkedMention(activeNote.content, m.title)
                    if (next) updateNoteContent(activeNoteId, next)
                  }}
                  title={`把首个提及包裹为 [[${m.title}]]`}
                >
                  链接
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
