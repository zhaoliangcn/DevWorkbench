// 知识库工具契约（切片 C.5 进阶版）：让 Agent 主动读取知识库笔记全文。
// 钉选注入只带路径与预览，全文按需经此工具读取，避免消息膨胀。
import { promises as fs } from 'node:fs'
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

/** 注册知识库工具（缺省 knowledge_read_note） */
export function registerKnowledgeTools(tools: { register: (spec: ToolSpec, handler: ToolHandler) => void }): void {
  tools.register(KNOWLEDGE_READ_NOTE_SPEC, knowledgeReadNoteHandler)
}
