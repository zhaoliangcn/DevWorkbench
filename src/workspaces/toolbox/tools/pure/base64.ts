/**
 * Base64 编解码纯函数（切片 B / 设计文档附录 C.3）。
 * 与主进程 electron/ipc/assistant-tools.ts 的 toolbox_base64 契约逻辑成对
 * （electron tsconfig rootDir 限制无法跨包共享源码，两侧实现保持极薄）。
 */

export interface Base64Input {
  text: string
  op: 'encode' | 'decode'
}

export interface Base64Output {
  result: string
  error?: string
}

/** UTF-8 安全的 Base64 编解码（TextEncoder/TextDecoder，替代已废弃的 escape/unescape 方案） */
export function base64Transform({ text, op }: Base64Input): Base64Output {
  try {
    if (op === 'encode') {
      const bytes = new TextEncoder().encode(text)
      let binary = ''
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
      return { result: btoa(binary) }
    }
    if (!/^[A-Za-z0-9+/=\s]+$/.test(text)) {
      return { result: '', error: '解码失败: 输入不是有效的 Base64 字符串' }
    }
    const binary = atob(text)
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    return { result: new TextDecoder().decode(bytes) }
  } catch {
    return op === 'encode'
      ? { result: '', error: '编码失败' }
      : { result: '', error: '解码失败: 输入不是有效的 Base64 字符串' }
  }
}
