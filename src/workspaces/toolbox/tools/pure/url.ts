// URL 编解码纯函数（切片 G，设计 C.3）。
// 与主进程 electron/ipc/assistant-tools.ts 的 toolbox_url 成对实现
// （electron tsconfig rootDir 限制无法共享源码，两侧均保持极薄）。

export interface UrlInput {
  text: string
  op: 'encode' | 'decode'
}

export interface UrlOutput {
  result: string
  error?: string
}

export function urlTransform(input: UrlInput): UrlOutput {
  const { text, op } = input
  try {
    if (op === 'decode') {
      // 校验：含 % 但不是合法百分号编码时 encodeURIComponent 系会抛 URIError
      return { result: decodeURIComponent(text) }
    }
    return { result: encodeURIComponent(text) }
  } catch {
    return {
      result: '',
      error: op === 'decode' ? '解码失败: 输入不是有效的编码URL' : '编码失败',
    }
  }
}
