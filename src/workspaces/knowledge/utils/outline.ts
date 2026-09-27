export interface HeadingItem {
  /** 1-6 */
  level: number
  text: string
  /** 与 renderMarkdown 注入的 `id="h-N"` 对应（文档序号） */
  id: string
}

/**
 * 大纲提取（附录 E E.3.5）：按文档序号收集 `# 标题` 行（1-6 级），
 * 跳过 ```/~~~ 围栏内的内容 —— 与 marked 的标题判定保持一致，序号才能对上。
 */
export function extractHeadings(content: string): HeadingItem[] {
  const headings: HeadingItem[] = []
  let inFence = false
  let fenceMark = ''
  let index = 0

  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim()
    const fence = line.match(/^(```+|~~~+)/)
    if (fence) {
      if (!inFence) {
        inFence = true
        fenceMark = fence[1][0].repeat(3) // 围栏至少 3 个相同字符
      } else if (fence[1][0] === fenceMark[0]) {
        inFence = false
      }
      continue
    }
    if (inFence) continue

    const heading = line.match(/^(#{1,6})\s+(.+)$/)
    if (heading) {
      headings.push({ level: heading[1].length, text: heading[2].trim(), id: `h-${index}` })
      index++
    }
  }
  return headings
}

/** 状态栏（附录 E E.3.5）：去空白字符数 + 阅读时长（约 400 字/分钟，至少 1 分钟） */
export function readingStats(content: string): { chars: number; minutes: number } {
  const chars = content.replace(/\s/g, '').length
  return { chars, minutes: Math.max(1, Math.ceil(chars / 400)) }
}
