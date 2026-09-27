import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../../../store/knowledgeStore'
import { groupNotesByDate, monthGrid } from '../utils/calendar'

const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * 附录 B.5.2：日历视图（RightPanel tab）。
 * 数据源 = 每日笔记（路径/标题含 YYYY-MM-DD）；点击日期打开当日笔记，无笔记则新建。
 */
export default function CalendarView() {
  const notes = useStore((s) => s.notes)
  const createNote = useStore((s) => s.createNote)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth() + 1)

  const byDate = useMemo(
    () => groupNotesByDate(Object.values(notes)),
    [notes],
  )
  const cells = useMemo(() => monthGrid(year, month), [year, month])

  const shift = (delta: number) => {
    let m = month + delta
    let y = year
    if (m < 1) {
      m = 12
      y -= 1
    } else if (m > 12) {
      m = 1
      y += 1
    }
    setYear(y)
    setMonth(m)
  }

  const clickDay = (day: number) => {
    const key = `${year}-${pad(month)}-${pad(day)}`
    const ids = byDate.get(key)
    if (ids && ids.length > 0) {
      setActiveNote(ids[0])
    } else {
      const id = createNote()
      setActiveNote(id)
    }
  }

  return (
    <div className="calendar-view">
      <div className="calendar-head">
        <button className="assistant-btn" onClick={() => shift(-1)} title="上一月">
          <ChevronLeft size={13} />
        </button>
        <span className="calendar-title">
          {year} 年 {month} 月
        </span>
        <button className="assistant-btn" onClick={() => shift(1)} title="下一月">
          <ChevronRight size={13} />
        </button>
      </div>
      <div className="calendar-grid">
        {WEEKDAYS.map((w) => (
          <div key={w} className="calendar-weekday">
            {w}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) return <div key={i} className="calendar-cell blank" />
          const key = `${year}-${pad(month)}-${pad(day)}`
          const ids = byDate.get(key)
          const isToday =
            year === today.getFullYear() && month === today.getMonth() + 1 && day === today.getDate()
          return (
            <div
              key={i}
              className={`calendar-cell ${ids ? 'has-note' : ''} ${isToday ? 'today' : ''}`}
              onClick={() => clickDay(day)}
              title={ids ? `打开 ${key}（${ids.length} 篇）` : `新建 ${key} 每日笔记`}
            >
              <span className="calendar-day">{day}</span>
              {ids && <span className="calendar-dot" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
