/**
 * 会话恢复的上下文回放（会话管理）。
 *
 * 背景：dev-assistant-ts 的 AppOptions.resumeFile 只让 SessionStore 续写同一个
 * JSONL 文件，Agent 的内存上下文（ContextManager）仍从零开始——直接 resume 的
 * 会话对模型是"失忆"的。此模块把历史事件回放进 ContextManager，使「继续会话」
 * 真正延续上下文。
 *
 * 设计约束：
 * - 纯逻辑 + 注入式 context 接口（结构兼容 ContextManager），vitest 直测
 * - 只回放对话文本（user/assistant/system）；tool 事件跳过——回放文本序列即可
 *   构成合法消息流（不会产生悬空的 tool_calls），且工具产出已体现在助手回复中
 * - 只保留最近 N 条，防止长会话回放挤爆 token 预算（截断数写进提示，轨迹文件可查全量）
 */

export interface ReplayTarget {
  appendSystem(content: string): void
  appendUser(content: string): void
  /** 与 ContextManager.appendAssistant 结构兼容（第二个可选参数不使用） */
  appendAssistant(content: string): void
}

export interface ReplayEvent {
  type?: unknown
  content?: unknown
}

/** 回放保留的最近对话消息条数上限 */
export const REPLAY_MAX_MESSAGES = 40

const REPLAYABLE_TYPES = new Set(['user_message', 'assistant_message', 'system_message'])

export interface ReplayResult {
  /** 实际回放的对话消息条数 */
  replayed: number
  /** 因超上限被截断的条数 */
  truncated: number
}

/**
 * 把历史会话事件回放进上下文。空会话不动上下文（由调用方决定提示语）；
 * 回放末尾追加一条系统说明，告知模型这是历史延续。
 */
export function replaySessionContext(target: ReplayTarget, events: ReplayEvent[]): ReplayResult {
  const dialog = events.filter(
    (e) => REPLAYABLE_TYPES.has(String(e?.type ?? '')) && typeof e?.content === 'string',
  )
  const truncated = Math.max(0, dialog.length - REPLAY_MAX_MESSAGES)
  const kept = truncated > 0 ? dialog.slice(-REPLAY_MAX_MESSAGES) : dialog
  if (kept.length === 0) return { replayed: 0, truncated: 0 }

  if (truncated > 0) {
    target.appendSystem(
      `【会话恢复】此会话较早还有 ${truncated} 条消息未回放（完整轨迹见会话记录）。`,
    )
  }
  for (const e of kept) {
    const type = String(e.type)
    const content = e.content as string
    if (type === 'user_message') target.appendUser(content)
    else if (type === 'assistant_message') target.appendAssistant(content)
    else target.appendSystem(content)
  }
  target.appendSystem('【会话恢复】以上为此前对话的回放，请在此基础上继续协助用户，不要复述回放内容。')
  return { replayed: kept.length, truncated }
}
