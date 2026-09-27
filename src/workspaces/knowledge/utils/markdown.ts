import type { Link } from '../../../types'

/** 提取 [[target]] / [[target|alias]] 的 target（去重，剔除空目标） */
export function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].split('|')[0].trim()
    if (target) links.push(target)
  }
  return [...new Set(links)]
}

/** 解析单个 wikilink 原文：[[target|alias]] → { target, alias? }（附录 E E.3.1 别名） */
export function parseWikiLink(raw: string): { target: string; alias: string | null } {
  const pipe = raw.indexOf('|')
  if (pipe === -1) return { target: raw.trim(), alias: null }
  return { target: raw.slice(0, pipe).trim(), alias: raw.slice(pipe + 1).trim() || null }
}

/** 转义 HTML 特殊字符：wikilink 标题来自用户内容，直接进 HTML 属性/文本会被注入 */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** 未解析链接：正文 [[target]] 中不在 titleToId 里的目标（死链，附录 E E.3.1） */
export function extractUnresolved(
  content: string,
  titleToId: Map<string, string>
): string[] {
  return extractWikiLinks(content).filter((t) => !titleToId.has(t))
}

/** 标题能否成为合法 wikilink 目标（含 [|] 的标题无法安全包裹） */
export function canBeWikiTarget(title: string): boolean {
  return title.length > 0 && !/[[\]|]/.test(title)
}

/** 按wikilink 切分正文，返回非链接的纯文本段（用于未链接提及检测） */
function plainSegments(content: string): string[] {
  const segments: string[] = []
  const regex = /\[\[[^\]]*\]\]/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    segments.push(content.slice(last, match.index))
    last = match.index + match[0].length
  }
  segments.push(content.slice(last))
  return segments
}

/** 未链接提及：titles 中作为纯文本出现在 content（不在任何 [[ ]] 内）的标题，大小写不敏感 */
export function findUnlinkedMentions(content: string, titles: string[]): string[] {
  const plain = plainSegments(content).join('\n').toLowerCase()
  if (!plain) return []
  return titles.filter((t) => canBeWikiTarget(t) && plain.includes(t.toLowerCase()))
}

/**
 * 一键包裹首个未链接提及为 [[title]]；无可包裹提及返回 null。
 * 仅替换纯文本段中的首个匹配（跳过已有 wikilink 内部）。
 */
export function wrapFirstUnlinkedMention(content: string, title: string): string | null {
  if (!canBeWikiTarget(title)) return null
  const lowerTitle = title.toLowerCase()
  const regex = /\[\[[^\]]*\]\]/g
  let last = 0
  let match: RegExpExecArray | null
  while ((match = regex.exec(content)) !== null) {
    const segment = content.slice(last, match.index)
    const idx = segment.toLowerCase().indexOf(lowerTitle)
    if (idx !== -1) {
      return (
        content.slice(0, last) +
        segment.slice(0, idx) +
        `[[${title}]]` +
        segment.slice(idx + title.length) +
        content.slice(match.index)
      )
    }
    last = match.index + match[0].length
  }
  const segment = content.slice(last)
  const idx = segment.toLowerCase().indexOf(lowerTitle)
  if (idx === -1) return null
  return (
    content.slice(0, last) +
    segment.slice(0, idx) +
    `[[${title}]]` +
    segment.slice(idx + title.length)
  )
}

export function extractTags(content: string): string[] {
  const regex = /#([\w\u4e00-\u9fff-]+)/g
  const matches = content.match(regex)
  if (!matches) return []
  return [...new Set(matches.map((t) => t.slice(1)))]
}

export function buildLinks(
  noteId: string,
  _noteTitle: string,
  content: string,
  titleToId: Map<string, string>
): Link[] {
  const wikiLinks = extractWikiLinks(content)
  return wikiLinks
    .map((targetTitle) => {
      const targetId = titleToId.get(targetTitle)
      if (!targetId || targetId === noteId) return null
      return { source: noteId, target: targetId }
    })
    .filter(Boolean) as Link[]
}

export function getBacklinks(links: Link[], noteId: string): Link[] {
  return links.filter((l) => l.target === noteId)
}

export function getOutlinks(links: Link[], noteId: string): Link[] {
  return links.filter((l) => l.source === noteId)
}

export function generateNoteId(): string {
  return 'note_' + Math.random().toString(36).slice(2, 10)
}

export function generateFolderId(): string {
  return 'folder_' + Math.random().toString(36).slice(2, 10)
}

export function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '-').trim() || 'untitled'
}
