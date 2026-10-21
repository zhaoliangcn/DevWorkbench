// 知识库检索打分纯函数层（无 IO、无 Electron 依赖，可被 vitest 直接覆盖）。
// 与渲染层 utils/search.ts 的 rankSearch 语义对齐：标题命中×3、标签×2、别名×2、正文×1。

/** 命中片段上下文字符数（与渲染层 utils/search.ts 的 SNIPPET_CONTEXT 一致） */
export const SNIPPET_CONTEXT = 40

export interface ScoredHit {
  score: number
  snippet: string | null
}

/** query 按空白拆词（多关键词），统一小写 */
export function splitTerms(query: string): string[] {
  return query
    .split(/\s+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/** 标签提取：行内 #tag + frontmatter 单行数组 tags: [a, b]（语义子集，与渲染层完整解析器对齐） */
export function extractTags(content: string): string[] {
  const tags = [...content.matchAll(/#([\w\u4e00-\u9fff-]+)/g)].map((m) => m[1].toLowerCase())
  const fmTagLine = content.match(/^tags:\s*\[(.+)\]\s*$/m)
  if (fmTagLine) {
    for (const raw of fmTagLine[1].split(',')) {
      tags.push(raw.trim().replace(/^["']|["']$/g, '').replace(/^#/, '').toLowerCase())
    }
  }
  return tags
}

/** 别名提取：frontmatter 单行数组 aliases: [a, b] */
export function extractAliases(content: string): string[] {
  const fm = content.match(/^aliases:\s*\[(.+)\]\s*$/m)
  if (!fm) return []
  return fm[1]
    .split(',')
    .map((s) => s.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
    .map((s) => s.toLowerCase())
}

/** 多词打分：逐词累加（标题×3 / 标签×2 / 别名×2 / 正文×1），任一词命中即计入，多词全中自然排前 */
export function scoreNoteTerms(title: string, content: string, terms: string[]): ScoredHit {
  const tl = title.toLowerCase()
  const cl = content.toLowerCase()
  const tags = extractTags(content)
  const aliases = extractAliases(content)

  let score = 0
  let snippet: string | null = null
  for (const term of terms) {
    if (tl.includes(term)) score += 3
    if (tags.some((t) => t.includes(term))) score += 2
    if (aliases.some((a) => a.includes(term))) score += 2
    const idx = cl.indexOf(term)
    if (idx !== -1) {
      score += 1
      if (snippet === null) {
        snippet = content
          .slice(Math.max(0, idx - SNIPPET_CONTEXT), idx + term.length + SNIPPET_CONTEXT)
          .replace(/\s+/g, ' ')
          .trim()
      }
    }
  }
  return { score, snippet }
}
