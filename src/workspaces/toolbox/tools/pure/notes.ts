// 随手记数据结构与导入/导出/合并纯函数（可单测，不依赖 Electron）

import type { NoteCipher } from './notesCrypto'

export interface Note {
  id: string
  title: string
  content: string
  category: string
  tags: string[]
  createdAt: number
  updatedAt: number
  pinned: boolean
  color: string
  /** 加密笔记：content 恒为空串，密文存于 cipher */
  encrypted?: boolean
  cipher?: NoteCipher
}

export interface NotesExportFile {
  app: 'DevWorkbench'
  type: 'notes'
  version: 1
  exportedAt: number
  notes: Note[]
}

export type MergeStrategy = 'skip' | 'overwrite'

export interface ImportResult {
  ok: boolean
  error?: string
  notes?: Note[]
  total?: number
  encrypted?: number
}

export function buildNotesExport(notes: Note[]): NotesExportFile {
  return { app: 'DevWorkbench', type: 'notes', version: 1, exportedAt: Date.now(), notes }
}

export function validateNotesImport(raw: string): ImportResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, error: '不是有效的 JSON 文件' }
  }
  const obj = parsed as Record<string, unknown> | null
  if (!obj || typeof obj !== 'object' || obj.type !== 'notes' || !Array.isArray(obj.notes)) {
    return { ok: false, error: '格式不符：缺少 type: "notes" 或 notes 数组' }
  }
  const notes: Note[] = []
  let encrypted = 0
  for (const item of obj.notes) {
    const n = item as Record<string, unknown>
    if (!n || typeof n !== 'object') continue
    if (typeof n.id !== 'string' || !n.id) continue
    if (typeof n.updatedAt !== 'number') continue
    const cipherValid =
      !!n.cipher &&
      typeof n.cipher === 'object' &&
      typeof (n.cipher as NoteCipher).salt === 'string' &&
      typeof (n.cipher as NoteCipher).iv === 'string' &&
      typeof (n.cipher as NoteCipher).data === 'string'
    const isEncrypted = n.encrypted === true && cipherValid
    if (!isEncrypted && typeof n.content !== 'string') continue
    notes.push({
      id: n.id,
      title: typeof n.title === 'string' && n.title ? n.title : '无标题',
      content: isEncrypted ? '' : (n.content as string),
      category: typeof n.category === 'string' && n.category ? n.category : '默认',
      tags: Array.isArray(n.tags) ? n.tags.filter((t): t is string => typeof t === 'string') : [],
      createdAt: typeof n.createdAt === 'number' ? n.createdAt : (n.updatedAt as number),
      updatedAt: n.updatedAt as number,
      pinned: n.pinned === true,
      color: typeof n.color === 'string' && n.color ? n.color : '#2d2d2d',
      encrypted: isEncrypted || undefined,
      cipher: isEncrypted ? (n.cipher as NoteCipher) : undefined,
    })
    if (isEncrypted) encrypted++
  }
  if (notes.length === 0) return { ok: false, error: '文件中没有可导入的笔记' }
  return { ok: true, notes, total: notes.length, encrypted }
}

export function mergeNotes(
  existing: Note[],
  imported: Note[],
  strategy: MergeStrategy,
): { merged: Note[]; added: number; updated: number } {
  const byId = new Map(existing.map((n) => [n.id, n]))
  let added = 0
  let updated = 0
  for (const note of imported) {
    if (byId.has(note.id)) {
      if (strategy === 'overwrite') {
        byId.set(note.id, note)
        updated++
      }
    } else {
      byId.set(note.id, note)
      added++
    }
  }
  return { merged: [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt), added, updated }
}
