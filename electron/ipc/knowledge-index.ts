// 知识库内存索引：vault 选择后懒初始化全量扫描，之后由 vault watcher 事件增量维护。
// 目标：knowledge_search_notes / knowledge_list_notes 零磁盘 IO、毫秒级返回，
// 不再每次调用都同步递归扫盘阻塞主进程。
// 设计约束：纯内存不落盘（无索引损坏/迁移问题）；只读缓存不触碰 filesystem.ts 封装；
// 本模块不 import vault.js（其顶层有 electron 依赖），事件由 vault.ts 反向调用 notifyVaultEvent。
import { promises as fsp, type Dirent } from 'node:fs'
import path from 'node:path'
import { extractTags, scoreNoteTerms, splitTerms } from './knowledge-score.js'

export interface IndexedNote {
  title: string
  content: string
}

export interface IndexHit {
  relPath: string
  score: number
  snippet: string | null
}

const index = new Map<string, IndexedNote>()
let indexRoot: string | null = null
/** 扫描代际：切换 vault 时旧扫描结果不再写入 */
let scanGen = 0
/** 进行中的全量扫描（首个工具调用会等待其完成） */
let initPromise: Promise<void> | null = null

export function indexedCount(): number {
  return index.size
}

export function indexedRoot(): string | null {
  return indexRoot
}

/** vault 是否已被索引覆盖（含初始化完成） */
export function isIndexReady(vault: string): boolean {
  return indexRoot === vault && initPromise === null
}

async function scanVault(vault: string, gen: number): Promise<void> {
  const walk = async (dir: string, prefix: string): Promise<void> => {
    let entries: Dirent[]
    try {
      entries = await fsp.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (gen !== scanGen) return // 期间切换了 vault，放弃旧扫描
      const full = path.join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (entry.name === 'trash' || entry.name === 'attachments') continue
        await walk(full, rel)
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        try {
          const content = await fsp.readFile(full, 'utf8')
          if (gen !== scanGen) return
          index.set(rel, { title: entry.name.replace(/\.md$/i, ''), content })
        } catch {
          // 单文件读取失败跳过
        }
      }
    }
  }
  await walk(vault, '')
}

/** 确保索引就绪：root 变化时重建，首次调用后台完成后缓存 */
export async function ensureVaultIndex(vault: string): Promise<void> {
  if (indexRoot === vault) {
    if (initPromise) await initPromise
    return
  }
  scanGen++
  indexRoot = vault
  index.clear()
  const gen = scanGen
  initPromise = scanVault(vault, gen).finally(() => {
    if (gen === scanGen) initPromise = null
  })
  await initPromise
}

/** vault.ts watcher 事件回调：回声更新也要进索引（自己的写入同样改变内容） */
export function notifyVaultEvent(relPath: string, kind: 'add' | 'change' | 'unlink', vault: string): void {
  if (!indexRoot || indexRoot !== vault) return
  if (relPath.startsWith('trash/') || relPath.startsWith('attachments/')) return
  if (kind === 'unlink') {
    index.delete(relPath)
    return
  }
  void fsp
    .readFile(path.join(vault, relPath), 'utf8')
    .then((content) => {
      if (indexRoot !== vault) return // 期间切换 vault，丢弃
      index.set(relPath, { title: path.basename(relPath).replace(/\.md$/i, ''), content })
    })
    .catch(() => {
      // 读取失败（如事件对应目录或文件已消失）：从索引移除，避免陈旧条目
      index.delete(relPath)
    })
}

/** 多词检索：逐篇打分（标题×3/标签×2/别名×2/正文×1 累加），按总分降序。
 * 返回全部命中（调用方自行截断 limit），以便上层报告「共 N 篇命中」 */
export function indexSearch(query: string): IndexHit[] {
  const terms = splitTerms(query)
  if (terms.length === 0) return []
  const hits: IndexHit[] = []
  for (const [relPath, note] of index) {
    const { score, snippet } = scoreNoteTerms(note.title, note.content, terms)
    if (score > 0) hits.push({ relPath, score, snippet })
  }
  hits.sort((a, b) => b.score - a.score)
  return hits
}

/** 全局清单：排序路径 + 标签摘要，供 Agent 先建立地图再定向细读 */
export function indexList(max: number): { lines: string[]; total: number } {
  const rels = [...index.keys()].sort()
  const lines = rels.slice(0, max).map((rel) => {
    const tags = extractTags(index.get(rel)?.content ?? '')
    return `- ${rel}` + (tags.length > 0 ? `（${tags.slice(0, 6).map((t) => `#${t}`).join(' ')}）` : '')
  })
  return { lines, total: rels.length }
}
