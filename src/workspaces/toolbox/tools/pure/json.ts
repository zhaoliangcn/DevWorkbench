/**
 * JSON 格式化/压缩纯函数（切片 B）。与主进程 toolbox_json 契约逻辑成对。
 */

export interface JsonInput {
  text: string
  action: 'format' | 'minify'
  indent?: number
}

export interface JsonOutput {
  result: string
  error?: string
}

export function jsonTransform({ text, action, indent = 2 }: JsonInput): JsonOutput {
  try {
    const parsed = JSON.parse(text) as unknown
    return {
      result:
        action === 'format' ? JSON.stringify(parsed, null, indent) : JSON.stringify(parsed),
    }
  } catch (e) {
    return { result: '', error: `JSON 格式错误: ${(e as Error).message}` }
  }
}
