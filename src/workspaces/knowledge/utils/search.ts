import type { Note } from '../../../types'

export interface SearchHit {
  note: Note
  score: number
  /** 正文首个命中点上下文片段；标题/标签命中而正文无命中时为 null */
  snippet: string | null
}

export const SNIPPET_CONTEXT = 40

/** 正文片段：首个命中点前后各 40 字，压缩空白，越界加省略号（附录 E E.3.2） */
export function extractSnippet(
  content: string,
  query: string,
  context = SNIPPET_CONTEXT
): string | null {
  if (!content || !query) return null
  const idx = content.toLowerCase().indexOf(query.toLowerCase())
  if (idx === -1) return null
  const start = Math.max(0, idx - context)
  const end = Math.min(content.length, idx + query.length + context)
  const body = content.slice(start, end).replace(/\s+/g, ' ').trim()
  return `${start > 0 ? '…' : ''}${body}${end < content.length ? '…' : ''}`
}

/**
 * 全文搜索排序（附录 E E.3.2）：标题命中 ×3 / 标签 ×2 / 正文 ×1；
 * 分数相同按 updatedAt 新者优先。纯内存扫描，1 万篇内无需索引。
 */
export function rankSearch(notes: Note[], query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []

  const hits: SearchHit[] = []
  for (const note of notes) {
    let score = 0
    if (note.title.toLowerCase().includes(q)) score += 3
    if (note.tags.some((t) => t.toLowerCase().includes(q))) score += 2
    if (note.content.toLowerCase().includes(q)) score += 1
    if (score === 0) continue
    hits.push({ note, score, snippet: extractSnippet(note.content, q) })
  }

  return hits.sort((a, b) => b.score - a.score || b.note.updatedAt - a.note.updatedAt)
}
