import { useMemo, useState } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import {
  extractFlashcards,
  parseSrsState,
  schedule,
  toDateStr,
  writeSrsState,
  type Flashcard,
  type Grade,
} from '../utils/spaced-repetition'

/** 复习单元：一篇 #flashcard 笔记的全部卡片作为一组（笔记级调度，状态存 frontmatter） */
interface DeckEntry {
  noteId: string
  title: string
  cards: Flashcard[]
  due: string | null
}

const GRADES: { grade: Grade; label: string }[] = [
  { grade: 'again', label: '忘记' },
  { grade: 'hard', label: '模糊' },
  { grade: 'good', label: '记住' },
  { grade: 'easy', label: '简单' },
]

interface Session {
  queue: DeckEntry[]
  idx: number
  cardIdx: number
  revealed: boolean
}

/**
 * 附录 B.5.4：间隔重复复习面板（RightPanel tab）。
 * 零 store 侵入：到期集合由笔记 tags + frontmatter 派生，评分写回走
 * updateNoteContent + writeSrsState（due/ease/interval/reviews 四键）。
 */
export default function ReviewPanel() {
  const notes = useStore((s) => s.notes)
  const updateNoteContent = useStore((s) => s.updateNoteContent)
  const setActiveNote = useStore((s) => s.setActiveNote)

  const [session, setSession] = useState<Session | null>(null)
  const [done, setDone] = useState<{ notes: number; cards: number } | null>(null)

  // 全库 #flashcard 笔记派生为复习单元
  const deck = useMemo(() => {
    const today = new Date()
    const entries: DeckEntry[] = []
    for (const n of Object.values(notes)) {
      if (!n.tags.includes('flashcard')) continue
      const cards = extractFlashcards(n.content)
      if (cards.length === 0) continue
      entries.push({
        noteId: n.id,
        title: n.title,
        cards,
        due: parseSrsState(n.content).due,
      })
    }
    // 排序：逾期（'0' 前缀）→ 今日到期 → 新卡（'3'，无 due）最后
    const t = toDateStr(today)
    return entries.sort((a, b) => {
      const ka = a.due ? (a.due < t ? `0${a.due}` : a.due) : '3'
      const kb = b.due ? (b.due < t ? `0${b.due}` : b.due) : '3'
      return ka.localeCompare(kb)
    })
  }, [notes])

  const todayStr = toDateStr(new Date())
  const dueEntries = deck.filter((e) => !e.due || e.due <= todayStr)
  const newCount = deck.filter((e) => !e.due).length

  const start = () => {
    setDone(null)
    setSession({ queue: dueEntries, idx: 0, cardIdx: 0, revealed: false })
  }

  const advance = (cardsSeen: number) => {
    if (!session) return
    const nextIdx = session.idx + 1
    if (nextIdx >= session.queue.length) {
      setSession(null)
      setDone((d) => ({
        notes: (d?.notes ?? 0) + 1,
        cards: (d?.cards ?? 0) + cardsSeen,
      }))
      return
    }
    setSession({ ...session, idx: nextIdx, cardIdx: 0, revealed: false })
  }

  const grade = (g: Grade) => {
    if (!session) return
    const entry = session.queue[session.idx]
    const note = notes[entry.noteId]
    if (note) {
      const next = schedule(parseSrsState(note.content), g, new Date())
      updateNoteContent(entry.noteId, writeSrsState(note.content, next))
    }
    advance(entry.cards.length)
  }

  const nextCard = () => {
    if (!session) return
    setSession({ ...session, cardIdx: session.cardIdx + 1, revealed: false })
  }

  // ===== 复习中 =====
  if (session) {
    const entry = session.queue[session.idx]
    const card = entry.cards[session.cardIdx]
    const isLastCard = session.cardIdx >= entry.cards.length - 1
    return (
      <div className="review-view">
        <div className="review-progress">
          {session.idx + 1} / {session.queue.length} 篇 · 卡片 {session.cardIdx + 1}/{entry.cards.length}
        </div>
        <button className="review-source" onClick={() => setActiveNote(entry.noteId)} title="打开笔记">
          {entry.title}
        </button>
        <div className="review-card">
          <div className="review-q">{card.q}</div>
          {session.revealed ? (
            <div className="review-a">
              {card.a || <span className="review-a-empty">（未填写答案）</span>}
            </div>
          ) : (
            <button className="review-reveal" onClick={() => setSession({ ...session, revealed: true })}>
              显示答案
            </button>
          )}
        </div>
        {session.revealed &&
          (isLastCard ? (
            <div className="review-grades">
              {GRADES.map((g) => (
                <button key={g.grade} className={`review-grade grade-${g.grade}`} onClick={() => grade(g.grade)}>
                  {g.label}
                </button>
              ))}
            </div>
          ) : (
            <button className="review-next" onClick={nextCard}>
              下一张
            </button>
          ))}
      </div>
    )
  }

  // ===== 本轮完成 =====
  if (done) {
    return (
      <div className="review-view">
        <div className="review-done">
          <p className="review-done-title">本轮复习完成</p>
          <p className="review-done-sub">
            {done.notes} 篇笔记 · {done.cards} 张卡片
          </p>
          <button className="review-start" onClick={() => setDone(null)}>
            返回
          </button>
        </div>
      </div>
    )
  }

  // ===== 概览 =====
  return (
    <div className="review-view">
      <p className="panel-empty-text">
        给笔记打 <code>#flashcard</code> 标签，正文用 <code>问：</code>/<code>答：</code>（或 Q:/A:）写卡片；
        调度状态存 frontmatter
      </p>
      <div className="review-stats">
        <span className="review-stat">
          今日到期 <b>{dueEntries.length}</b>
        </span>
        <span className="review-stat">
          新卡 <b>{newCount}</b>
        </span>
        <span className="review-stat">
          共 <b>{deck.length}</b> 篇
        </span>
      </div>
      {dueEntries.length > 0 ? (
        <button className="review-start" onClick={start}>
          开始复习（{dueEntries.length} 篇）
        </button>
      ) : (
        <p className="review-clear">今日复习已完成，明天再来</p>
      )}
      <div className="review-deck">
        {deck.map((e) => (
          <div
            key={e.noteId}
            className={`review-deck-item ${e.due && e.due <= todayStr ? 'due' : ''}`}
            onClick={() => setActiveNote(e.noteId)}
            title={e.due ? `下次复习：${e.due}` : '新卡'}
          >
            <span className="review-deck-title">{e.title}</span>
            <span className="review-deck-meta">
              {e.cards.length} 卡 · {e.due ?? '新'}
            </span>
          </div>
        ))}
        {deck.length === 0 && <p className="panel-empty-text">暂无 #flashcard 笔记</p>}
      </div>
    </div>
  )
}
