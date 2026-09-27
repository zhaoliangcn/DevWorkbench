// 附录 B.5.2：日历视图纯函数（不引库；日期分组与月网格几何）

/** 从笔记路径/标题提取每日笔记日期（YYYY-MM-DD），非日期笔记返回 null */
export function dailyNoteDate(note: { path: string; title: string }): string | null {
  const m = note.path.match(/(\d{4}-\d{2}-\d{2})/) ?? note.title.match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : null
}

/** 笔记按日期分组（key 为 YYYY-MM-DD；同日多篇按 updatedAt 降序） */
export function groupNotesByDate(notes: { id: string; path: string; title: string; updatedAt: number }[]): Map<string, string[]> {
  const map = new Map<string, { id: string; updatedAt: number }[]>()
  for (const n of notes) {
    const date = dailyNoteDate(n)
    if (!date) continue
    const list = map.get(date) ?? []
    list.push({ id: n.id, updatedAt: n.updatedAt })
    map.set(date, list)
  }
  const result = new Map<string, string[]>()
  for (const [date, list] of map) {
    result.set(
      date,
      list.sort((a, b) => b.updatedAt - a.updatedAt).map((x) => x.id),
    )
  }
  return result
}

/**
 * 月网格几何：返回 length 42 的槽位（6 行 × 7 列，周一开始），
 * null = 前后月留白；number = 当月日期。
 */
export function monthGrid(year: number, month: number): (number | null)[] {
  const first = new Date(year, month - 1, 1)
  const daysInMonth = new Date(year, month, 0).getDate()
  const lead = (first.getDay() + 6) % 7 // 周一=0
  const cells: (number | null)[] = Array.from({ length: lead }, () => null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(d)
  while (cells.length % 7 !== 0) cells.push(null)
  while (cells.length < 42) cells.push(null)
  return cells
}
