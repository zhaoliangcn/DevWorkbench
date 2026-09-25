import type { Link } from '../../../types'

export function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let match
  while ((match = regex.exec(content)) !== null) {
    const target = match[1].split('|')[0].trim()
    links.push(target)
  }
  return [...new Set(links)]
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
