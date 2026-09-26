import type { App } from 'dev-assistant-ts'

/**
 * 工具箱 → Agent 工具契约（设计文档附录 C.3 / 切片 B）。
 *
 * 走核心 App（dev-assistant-ts 根导出）而非 embed 门面：embed 未暴露
 * ToolRegistry，而 App.create 返回的 App 公开 readonly tools，可在启动后
 * register 注入自定义工具（Agent 运行时按同一注册表实例动态读取 schema）。
 *
 * 安全：仅注册纯计算工具（无 IO / 无命令执行），dangerLevel 一律 low，
 * 自动审批（approvalEnabled:false）模式下不新增风险面。
 * 与渲染端 src/workspaces/toolbox/tools/pure/* 逻辑成对（electron tsconfig
 * rootDir 限制无法跨包共享源码，两侧实现均保持极薄）。
 */

type AppTools = App['tools']
type ToolSpec = Parameters<AppTools['register']>[0]
type ToolHandler = Parameters<AppTools['register']>[1]

export const TOOLBOX_TOOL_NAMES = [
  'toolbox_base64',
  'toolbox_timestamp',
  'toolbox_json',
  'toolbox_url',
  'toolbox_radix',
  'toolbox_regex',
] as const
export type ToolboxToolName = (typeof TOOLBOX_TOOL_NAMES)[number]

function result(success: boolean, content: string) {
  return { success, content, restartRequested: false }
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

const specs: Record<ToolboxToolName, { spec: ToolSpec; handler: ToolHandler }> = {
  toolbox_base64: {
    spec: {
      name: 'toolbox_base64',
      description: 'Base64 编解码。text 为原文（encode）或 Base64 串（decode），op 指定方向。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待处理文本' },
          op: { type: 'string', enum: ['encode', 'decode'] },
        },
        required: ['text', 'op'],
      },
      dangerLevel: 'low',
    },
    handler: async (args) => {
      const { text, op } = args.arguments as { text: string; op: 'encode' | 'decode' }
      try {
        if (op === 'decode') {
          if (!/^[A-Za-z0-9+/=\s]+$/.test(text ?? '')) {
            return result(false, '输入不是有效的 Base64 字符串')
          }
          return result(true, Buffer.from(text, 'base64').toString('utf8'))
        }
        return result(true, Buffer.from(text ?? '', 'utf8').toString('base64'))
      } catch (e) {
        return result(false, errMessage(e))
      }
    },
  },

  toolbox_timestamp: {
    spec: {
      name: 'toolbox_timestamp',
      description:
        'Unix 时间戳与日期互转。action=toDatetime 时 value 为秒/毫秒时间戳；action=toUnix 时 value 为日期字符串。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['toDatetime', 'toUnix'] },
          value: { type: 'string' },
        },
        required: ['action', 'value'],
      },
      dangerLevel: 'low',
    },
    handler: async (args) => {
      const { action, value } = args.arguments as { action: string; value: string }
      if (action === 'toDatetime') {
        const ts = parseInt(value, 10)
        if (Number.isNaN(ts)) return result(false, '无效的时间戳')
        const date = new Date(ts > 1e12 ? ts : ts * 1000)
        if (isNaN(date.getTime())) return result(false, '无效的时间戳')
        return result(true, `${date.toISOString()}\n本地: ${date.toLocaleString('zh-CN')}`)
      }
      const date = new Date(value)
      if (isNaN(date.getTime())) return result(false, '无效的日期格式')
      return result(true, `秒: ${Math.floor(date.getTime() / 1000)}\n毫秒: ${date.getTime()}`)
    },
  },

  toolbox_json: {
    spec: {
      name: 'toolbox_json',
      description: 'JSON 格式化（action=format，indent 默认 2）或压缩（action=minify）。',
      parameters: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['format', 'minify'] },
          text: { type: 'string', description: 'JSON 文本' },
          indent: { type: 'number', description: 'format 缩进空格数，默认 2' },
        },
        required: ['action', 'text'],
      },
      dangerLevel: 'low',
    },
    handler: async (args) => {
      const { action, text, indent } = args.arguments as {
        action: string
        text: string
        indent?: number
      }
      try {
        const parsed = JSON.parse(text) as unknown
        const content =
          action === 'minify'
            ? JSON.stringify(parsed)
            : JSON.stringify(parsed, null, typeof indent === 'number' ? indent : 2)
        return result(true, content)
      } catch (e) {
        return result(false, `JSON 格式错误: ${errMessage(e)}`)
      }
    },
  },

  toolbox_url: {
    spec: {
      name: 'toolbox_url',
      description: 'URL 百分号编解码。text 为原文（encode）或已编码串（decode），op 指定方向。',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: '待处理文本' },
          op: { type: 'string', enum: ['encode', 'decode'] },
        },
        required: ['text', 'op'],
      },
      dangerLevel: 'low',
    },
    handler: async (args) => {
      const { text, op } = args.arguments as { text: string; op: 'encode' | 'decode' }
      try {
        return result(true, op === 'decode' ? decodeURIComponent(text) : encodeURIComponent(text))
      } catch {
        return result(false, op === 'decode' ? '解码失败: 输入不是有效的编码URL' : '编码失败')
      }
    },
  },

  toolbox_radix: {
    spec: {
      name: 'toolbox_radix',
      description:
        '任意进制（2-36）整数转换。value 为数字字符串（可带负号），fromBase/toBase 为进制。BigInt 运算无精度丢失。',
      parameters: {
        type: 'object',
        properties: {
          value: { type: 'string', description: '数字字符串' },
          fromBase: { type: 'number', description: '源进制 2-36' },
          toBase: { type: 'number', description: '目标进制 2-36' },
        },
        required: ['value', 'fromBase', 'toBase'],
      },
      dangerLevel: 'low',
    },
    handler: async (args) => {
      const { value, fromBase, toBase } = args.arguments as {
        value: string
        fromBase: number
        toBase: number
      }
      // 与渲染端 pure/radix.ts 成对实现（BigInt 逐位累加，完整校验）
      const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'
      if (!Number.isInteger(fromBase) || fromBase < 2 || fromBase > 36) {
        return result(false, '源进制必须在 2-36 之间')
      }
      if (!Number.isInteger(toBase) || toBase < 2 || toBase > 36) {
        return result(false, '目标进制必须在 2-36 之间')
      }
      const v = (value ?? '').trim()
      if (!v) return result(false, '无效的输入')
      let body = v
      let sign = ''
      if (body.startsWith('-')) {
        sign = '-'
        body = body.slice(1)
      }
      if (!body) return result(false, '无效的输入')
      let n = 0n
      for (const ch of body.toLowerCase()) {
        const d = DIGITS.indexOf(ch)
        if (d < 0 || d >= fromBase) return result(false, `无效的输入：字符 "${ch}" 不是 ${fromBase} 进制位`)
        n = n * BigInt(fromBase) + BigInt(d)
      }
      return result(true, sign + n.toString(toBase))
    },
  },

  toolbox_regex: {
    spec: {
      name: 'toolbox_regex',
      description:
        '正则表达式测试。返回全部匹配（含分组与位置），上限 1000 个；g 模式空匹配自动推进避免死循环。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: '正则表达式（不带斜杠）' },
          flags: { type: 'string', description: '标志，如 g / i / m' },
          text: { type: 'string', description: '测试文本' },
        },
        required: ['pattern', 'flags', 'text'],
      },
      dangerLevel: 'low',
    },
    handler: async (args) => {
      const { pattern, flags, text } = args.arguments as {
        pattern: string
        flags: string
        text: string
      }
      let regex: RegExp
      try {
        regex = new RegExp(pattern, flags)
      } catch (e) {
        return result(false, errMessage(e))
      }
      const out: string[] = []
      let m: RegExpExecArray | null
      while ((m = regex.exec(text)) !== null) {
        const groups = m.slice(1)
        out.push(
          `#${out.length + 1} @${m.index}: ${m[0]}${groups.length ? ` | 分组: ${groups.join(', ')}` : ''}`,
        )
        if (!regex.global || m[0] === '') {
          if (regex.global) regex.lastIndex++
          else break
        }
        if (out.length >= 1000) {
          out.push('…（已达 1000 条上限）')
          break
        }
      }
      return result(true, out.length ? out.join('\n') : '无匹配')
    },
  },
}

/** 启动后向 Agent 注册表注入工具箱工具（names 为空/缺省时注册全部） */
export function registerToolboxTools(tools: AppTools, names?: readonly string[]): void {
  for (const name of TOOLBOX_TOOL_NAMES) {
    if (names && !names.includes(name)) continue
    const { spec, handler } = specs[name]
    if (!tools.has(name)) tools.register(spec, handler)
  }
}
