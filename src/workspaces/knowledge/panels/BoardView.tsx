import { useMemo, useState } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { parseFrontmatter, updateFrontmatterKey } from '../utils/frontmatter'

/** 看板列定义：内置三态 + 无状态收件列（status 为 null 的笔记） */
const COLUMNS: { key: string | null; label: string }[] = [
  { key: null, label: '收件箱' },
  { key: 'todo', label: '待办' },
  { key: 'doing', label: '进行中' },
  { key: 'done', label: '已完成' },
]

/**
 * 附录 B.5.2：看板视图（RightPanel tab）。
 * 列 = frontmatter status；拖拽改写 status（零 store 侵入：updateNoteContent + updateFrontmatterKey）。
 */
export default function BoardView() {
  const notes = useStore((s) => s.notes)
  const updateNoteContent = useStore((s) => s.updateNoteContent)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const [dragId, setDragId] = useState<string | null>(null)
  const [overCol, setOverCol] = useState<string | null>(null)

  const all = useMemo(() => Object.values(notes), [notes])
  const grouped = useMemo(() => {
    const map = new Map<string | null, typeof all>(COLUMNS.map((c) => [c.key, []]))
    for (const n of all) {
      const status = parseFrontmatter(n.content).status
      map.get(status ?? null)?.push(n)
    }
    return map
  }, [all])

  const drop = (colKey: string | null) => {
    if (!dragId) return
    const note = notes[dragId]
    if (!note) return
    updateNoteContent(dragId, updateFrontmatterKey(note.content, 'status', colKey))
    setDragId(null)
    setOverCol(null)
  }

  return (
    <div className="board-view">
      <p className="panel-empty-text">拖拽卡片调整状态（写入 frontmatter status）</p>
      <div className="board-columns">
        {COLUMNS.map((col) => {
          const items = grouped.get(col.key) ?? []
          return (
            <div
              key={col.label}
              className={`board-col ${overCol === col.label ? 'over' : ''}`}
              onDragOver={(e) => {
                e.preventDefault()
                setOverCol(col.label)
              }}
              onDragLeave={() => setOverCol((c) => (c === col.label ? null : c))}
              onDrop={() => drop(col.key)}
            >
              <div className="board-col-head">
                {col.label}
                <span className="board-col-count">{items.length}</span>
              </div>
              {items.map((n) => (
                <div
                  key={n.id}
                  className="board-card"
                  draggable
                  onDragStart={() => setDragId(n.id)}
                  onDragEnd={() => {
                    setDragId(null)
                    setOverCol(null)
                  }}
                  onClick={() => setActiveNote(n.id)}
                  title={n.path}
                >
                  {n.title}
                </div>
              ))}
              {items.length === 0 && <p className="board-col-empty">空</p>}
            </div>
          )
        })}
      </div>
    </div>
  )
}
