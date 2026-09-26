// 钉选上下文注入纯函数（C.5 进阶版）——从 AssistantWorkspace.handleSend 抽出以便单测。
// 注入策略：路径清单 + 内容预览（600 字符），全文由 Agent 按需调用 knowledge_read_note 读取。

export interface PinnedNoteLite {
  path: string
  content?: string
}

/** 每篇笔记预览字符上限 */
export const PREVIEW_CHARS = 600

export function buildPinnedContext(notes: PinnedNoteLite[], text: string): string {
  if (notes.length === 0) return text
  const lines = notes
    .map((n) => `- ${n.path}\n  预览: ${(n.content ?? '').slice(0, PREVIEW_CHARS).replace(/\s+/g, ' ')}`)
    .join('\n')
  return `【知识库钉选上下文】\n${lines}\n（如需笔记全文，请调用 knowledge_read_note 工具按上述路径读取）\n\n【用户问题】\n${text}`
}
