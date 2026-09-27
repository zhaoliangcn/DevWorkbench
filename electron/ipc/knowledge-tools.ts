// 知识库工具契约（切片 C.5 进阶版）：让 Agent 主动读取知识库笔记全文。
// 钉选注入只带路径与预览，全文按需经此工具读取，避免消息膨胀。
import { promises as fs, readdirSync, readFileSync, type Dirent } from 'node:fs'
import path from 'node:path'
import type { ToolSpec } from '../../node_modules/dev-assistant-ts/dist/tools/spec.js'
import type { ToolHandler } from '../../node_modules/dev-assistant-ts/dist/tools/registry.js'
import { getVaultPath } from './vault.js'

interface ToolResult {
  success: boolean
  content: string
  restartRequested: boolean
}

function result(success: boolean, content: string): ToolResult {
  return { success, content, restartRequested: false }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

/** 单次返回上限（字符），超出截断并提示用 offsetChars 分段 */
const MAX_CHARS = 20000

export const KNOWLEDGE_READ_NOTE_SPEC: ToolSpec = {
  name: 'knowledge_read_note',
  description:
    '读取知识库笔记全文。path 为相对知识库根目录的路径（绝对路径亦可，但必须位于知识库目录内）。' +
    '长文可用 offsetChars 分段读取（字符偏移）。调用前参考消息中的【知识库钉选上下文】路径清单。',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: '笔记路径（相对知识库根目录）' },
      offsetChars: { type: 'number', description: '可选，起始字符偏移，默认 0' },
    },
    required: ['path'],
  },
  dangerLevel: 'low',
}

export const knowledgeReadNoteHandler: ToolHandler = async (args) => {
  const vault = getVaultPath()
  if (!vault) return result(false, '尚未选择知识库文件夹')

  const raw = String((args.arguments as { path?: unknown }).path ?? '').trim()
  if (!raw) return result(false, '缺少 path 参数')

  // 安全校验：只允许读取 vault 目录内的文件
  const resolved = path.resolve(vault, raw)
  if (!resolved.startsWith(path.resolve(vault) + path.sep)) {
    return result(false, '路径越界：只允许读取知识库目录内的笔记')
  }

  try {
    const stat = await fs.stat(resolved)
    if (!stat.isFile()) return result(false, `不是文件: ${raw}`)

    const full = await fs.readFile(resolved, 'utf8')
    const offset = Math.max(0, Math.floor(Number((args.arguments as { offsetChars?: unknown }).offsetChars ?? 0)))
    const slice = full.slice(offset, offset + MAX_CHARS)
    const header = offset > 0 ? `（从偏移 ${offset} 开始）` : ''
    const tail = offset + MAX_CHARS < full.length ? `\n…（已截断，全文 ${full.length} 字符，可用 offsetChars=${offset + MAX_CHARS} 继续读取）` : ''
    return result(true, `${header}${slice}${tail}`)
  } catch (e) {
    return result(false, `读取失败: ${errMessage(e)}`)
  }
}

/** 注册知识库工具（缺省 knowledge_read_note + knowledge_search_notes） */
export function registerKnowledgeTools(tools: { register: (spec: ToolSpec, handler: ToolHandler) => void }): void {
  tools.register(KNOWLEDGE_READ_NOTE_SPEC, knowledgeReadNoteHandler)
  tools.register(KNOWLEDGE_SEARCH_NOTES_SPEC, knowledgeSearchNotesHandler)
}

/* ---------- knowledge_search_notes（附录 E E.3.7）：检索 → 细读链路的检索端 ---------- */

/** 命中片段上下文字符数（与渲染层 utils/search.ts 的 SNIPPET_CONTEXT 一致） */
const SNIPPET_CONTEXT = 40
/** 单次返回条数上限 */
const SEARCH_MAX_LIMIT = 20

export const KNOWLEDGE_SEARCH_NOTES_SPEC: ToolSpec = {
  name: 'knowledge_search_notes',
  description:
    '按关键词检索知识库笔记全文（标题命中×3、标签×2、正文×1 加权排序），返回路径、得分与正文片段。' +
    '结果中的 path 可直接传给 knowledge_read_note 细读。',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '关键词' },
      limit: { type: 'number', description: `可选，最多返回条数（1-${SEARCH_MAX_LIMIT}），默认 8` },
    },
    required: ['query'],
  },
  dangerLevel: 'low',
}

interface SearchHitLite {
  relPath: string
  score: number
  snippet: string | null
}

/** 打分规则与渲染层 rankSearch 对齐：标题 includes×3 / 标签 some×2 / 正文 includes×1 */
function scoreNote(title: string, content: string, q: string): { score: number; snippet: string | null } {
  const ql = q.toLowerCase()
  let score = 0
  if (title.toLowerCase().includes(ql)) score += 3

  // 标签：行内 #tag + frontmatter 单行数组 tags: [a, b]（渲染层有完整解析器，此处取语义子集）
  const tags = [...content.matchAll(/#([\w\u4e00-\u9fff-]+)/g)].map((m) => m[1].toLowerCase())
  const fmTagLine = content.match(/^tags:\s*\[(.+)\]\s*$/m)
  if (fmTagLine) {
    for (const raw of fmTagLine[1].split(',')) {
      tags.push(raw.trim().replace(/^["']|["']$/g, '').replace(/^#/, '').toLowerCase())
    }
  }
  if (tags.some((t) => t.includes(ql))) score += 2

  const lower = content.toLowerCase()
  if (lower.includes(ql)) score += 1

  const idx = lower.indexOf(ql)
  const snippet =
    idx === -1
      ? null
      : content.slice(Math.max(0, idx - SNIPPET_CONTEXT), idx + q.length + SNIPPET_CONTEXT).replace(/\s+/g, ' ').trim()
  return { score, snippet }
}

/** 遍历 vault 收集 .md（跳过 trash/attachments，与 file:list 同规则） */
function collectMdFiles(dir: string, prefix: string, out: { relPath: string; title: string; content: string }[]): void {
  let entries: Dirent[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      if (entry.name === 'trash' || entry.name === 'attachments') continue
      collectMdFiles(full, rel, out)
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      try {
        out.push({
          relPath: rel,
          title: entry.name.replace(/\.md$/i, ''),
          content: readFileSync(full, 'utf8'),
        })
      } catch {
        // 单文件读取失败跳过，不阻断搜索
      }
    }
  }
}

export const knowledgeSearchNotesHandler: ToolHandler = async (args) => {
  const vault = getVaultPath()
  if (!vault) return result(false, '尚未选择知识库文件夹')

  const query = String((args.arguments as { query?: unknown }).query ?? '').trim()
  if (!query) return result(false, '缺少 query 参数')
  const limit = Math.min(
    SEARCH_MAX_LIMIT,
    Math.max(1, Math.floor(Number((args.arguments as { limit?: unknown }).limit ?? 8)) || 8),
  )

  const files: { relPath: string; title: string; content: string }[] = []
  collectMdFiles(vault, '', files)

  const hits: SearchHitLite[] = []
  for (const f of files) {
    const { score, snippet } = scoreNote(f.title, f.content, query)
    if (score > 0) hits.push({ relPath: f.relPath, score, snippet })
  }
  hits.sort((a, b) => b.score - a.score)

  if (hits.length === 0) {
    return result(true, `未找到与「${query}」相关的笔记`)
  }

  const shown = hits.slice(0, limit)
  const lines = shown.map(
    (h) => `- ${h.relPath}（得分 ${h.score}）\n  片段: ${h.snippet ?? '—'}`,
  )
  const note = hits.length > shown.length ? `（共 ${hits.length} 篇命中，仅列前 ${shown.length} 条）` : `（共 ${hits.length} 篇命中）`
  return result(true, `搜索「${query}」${note}，path 可直接传给 knowledge_read_note 细读：\n${lines.join('\n')}`)
}
