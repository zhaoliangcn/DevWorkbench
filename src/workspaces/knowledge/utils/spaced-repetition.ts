// 附录 B.5.4：间隔重复（Anki 化）纯函数（不引库）
// - 卡片提取：#flashcard 标记笔记正文中的 Q/A 对（中英文前缀，标题行可作边界）
// - SM-2 简化调度：四档评分，调度状态持久化在笔记 frontmatter（due/ease/interval/reviews）

import { updateFrontmatterKey } from './frontmatter'

export type Grade = 'again' | 'hard' | 'good' | 'easy'

export interface SrsState {
  /** 下次复习日期（YYYY-MM-DD）；null = 新卡未调度 */
  due: string | null
  /** 难度系数，限 [1.3, 3.0] */
  ease: number
  /** 当前复习间隔（天） */
  interval: number
  /** 连续答对次数（again 清零） */
  reviews: number
}

export const DEFAULT_SRS: SrsState = { due: null, ease: 2.5, interval: 0, reviews: 0 }

export interface Flashcard {
  q: string
  a: string
}

/** SM-2 质量分映射：again=1（失败）hard=3 good=4 easy=5 */
const QUALITY: Record<Grade, number> = { again: 1, hard: 3, good: 4, easy: 5 }

const MIN_EASE = 1.3
const MAX_EASE = 3.0

const Q_RE = /^(?:Q|问)\s*[:：]\s*(.*)$/
const A_RE = /^(?:A|答)\s*[:：]\s*(.*)$/

/** 本地时区日期串 YYYY-MM-DD（不用 toISOString，避免时区偏移整天） */
export function toDateStr(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${m}-${day}`
}

/** 本地日期加 n 天（跨月/年交给 Date） */
export function addDays(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

/**
 * 从笔记正文提取闪卡：`Q:`/`问：` 行开新卡，`A:`/`答：` 行起答案，
 * 答案延续到下一个 Q 或下一个标题行为止（标题行是卡片边界）。
 * 行内 #flashcard 与 frontmatter tags 的识别由 store 的 extractAllTags 负责，此处不重复。
 * 代码围栏内的行不参与识别。
 */
export function extractFlashcards(content: string): Flashcard[] {
  const cards: Flashcard[] = []
  let q: string | null = null
  let aLines: string[] = []
  let inCode = false

  const push = () => {
    if (q !== null && q.trim().length > 0) {
      cards.push({ q: q.trim(), a: aLines.join('\n').trim() })
    }
    q = null
    aLines = []
  }

  for (const raw of content.split('\n')) {
    const trimmed = raw.trim()
    if (trimmed.startsWith('```')) {
      inCode = !inCode
      continue
    }
    if (inCode) continue

    // 剥掉标题前缀再匹配：`## 问：xxx` 等价于 `问：xxx`
    const heading = trimmed.match(/^#{1,6}\s+(.*)$/)
    const line = heading ? heading[1] : trimmed

    const qm = line.match(Q_RE)
    if (qm) {
      push()
      q = qm[1]
      continue
    }
    // 非 Q/问 的标题行：卡片边界
    if (heading) {
      push()
      continue
    }
    const am = line.match(A_RE)
    if (am) {
      if (q !== null) aLines.push(am[1]) // 无 Q 的孤立 A 行忽略
      continue
    }
    if (q !== null) aLines.push(trimmed)
  }
  push()
  return cards
}

/** 是否到期（含逾期）；无 due 视为新卡即到期 */
export function isDue(state: SrsState, today: Date = new Date()): boolean {
  if (!state.due) return true
  return state.due <= toDateStr(today)
}

/**
 * SM-2 简化调度（四档评分，间隔为整天）：
 * - again：ease 按 SM-2 公式大降，interval 回 1 天，连续答对清零
 * - hard/good/easy：ease 小幅调整；前两次连续答对用固定阶梯（1/2/4 → 3/6/8 天），
 *   之后按倍率（hard ×1.2、good ×ease、easy ×ease×1.25）增长，且保证不缩水（至少 +1 天）
 */
export function schedule(state: SrsState, grade: Grade, today: Date = new Date()): SrsState {
  const q = QUALITY[grade]
  const delta = 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  const ease = Math.min(MAX_EASE, Math.max(MIN_EASE, Math.round((state.ease + delta) * 100) / 100))

  if (grade === 'again') {
    return { due: toDateStr(addDays(today, 1)), ease, interval: 1, reviews: 0 }
  }

  const reviews = state.reviews + 1
  let interval: number
  if (reviews === 1) {
    interval = grade === 'hard' ? 1 : grade === 'good' ? 2 : 4
  } else if (reviews === 2) {
    interval = grade === 'hard' ? 3 : grade === 'good' ? 6 : 8
  } else {
    const mult = grade === 'hard' ? 1.2 : grade === 'easy' ? ease * 1.25 : ease
    interval = Math.max(state.interval + 1, Math.round(state.interval * mult))
  }
  return { due: toDateStr(addDays(today, interval)), ease, interval, reviews }
}

/** 从 frontmatter 读取调度状态（缺键/非法值回退默认；围栏未闭合视无状态） */
export function parseSrsState(content: string): SrsState {
  const lines = content.split('\n')
  if (lines[0].trim() !== '---') return { ...DEFAULT_SRS }
  let close = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      close = i
      break
    }
  }
  if (close < 0) return { ...DEFAULT_SRS }

  const read = (key: string): string | null => {
    const re = new RegExp(`^${key}\\s*:\\s*(.*)$`)
    for (let i = 1; i < close; i++) {
      const m = lines[i].trim().match(re)
      if (m) return m[1].trim() || null
    }
    return null
  }

  const due = read('due')
  const ease = Number.parseFloat(read('ease') ?? '')
  const interval = Number.parseInt(read('interval') ?? '', 10)
  const reviews = Number.parseInt(read('reviews') ?? '', 10)
  return {
    due: due && /^\d{4}-\d{2}-\d{2}$/.test(due) ? due : null,
    ease: Number.isFinite(ease) ? Math.min(MAX_EASE, Math.max(MIN_EASE, ease)) : DEFAULT_SRS.ease,
    interval: Number.isFinite(interval) && interval >= 0 ? interval : DEFAULT_SRS.interval,
    reviews: Number.isFinite(reviews) && reviews >= 0 ? reviews : DEFAULT_SRS.reviews,
  }
}

/** 写回调度状态到 frontmatter（updateFrontmatterKey 链式；null = 清除全部调度键） */
export function writeSrsState(content: string, state: SrsState | null): string {
  if (!state) {
    let out = updateFrontmatterKey(content, 'due', null)
    out = updateFrontmatterKey(out, 'ease', null)
    out = updateFrontmatterKey(out, 'interval', null)
    return updateFrontmatterKey(out, 'reviews', null)
  }
  let out = updateFrontmatterKey(content, 'due', state.due)
  out = updateFrontmatterKey(out, 'ease', String(state.ease))
  out = updateFrontmatterKey(out, 'interval', String(state.interval))
  return updateFrontmatterKey(out, 'reviews', String(state.reviews))
}
