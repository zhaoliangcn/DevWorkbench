// 会话恢复上下文回放（会话管理）纯逻辑测试：
// 事件过滤、顺序保持、截断上限、空会话、非文本事件跳过
import { describe, it, expect } from 'vitest'
import { replaySessionContext, REPLAY_MAX_MESSAGES, type ReplayTarget, type ReplayEvent } from '../electron/ipc/session-replay'

/** 录制型假 ContextManager：记录每类 append 的调用序列 */
function makeRecorder(): ReplayTarget & { calls: Array<{ kind: string; content: string }> } {
  const calls: Array<{ kind: string; content: string }> = []
  return {
    calls,
    appendSystem: (content) => calls.push({ kind: 'system', content }),
    appendUser: (content) => calls.push({ kind: 'user', content }),
    appendAssistant: (content) => calls.push({ kind: 'assistant', content }),
  }
}

function msg(type: 'user_message' | 'assistant_message' | 'system_message', content: string): ReplayEvent {
  return { type, content }
}

describe('replaySessionContext（会话恢复回放）', () => {
  it('按原顺序回放 user/assistant 消息，末尾追加恢复说明', () => {
    const r = makeRecorder()
    const res = replaySessionContext(r, [
      msg('user_message', '第一问'),
      msg('assistant_message', '第一答'),
      msg('user_message', '第二问'),
    ])
    expect(res).toEqual({ replayed: 3, truncated: 0 })
    expect(r.calls.map((c) => c.kind)).toEqual(['user', 'assistant', 'user', 'system'])
    expect(r.calls[0].content).toBe('第一问')
    expect(r.calls[2].content).toBe('第二问')
    expect(r.calls[3].content).toContain('会话恢复')
  })

  it('跳过 tool / 压缩 / 摘要等非对话事件', () => {
    const r = makeRecorder()
    const res = replaySessionContext(r, [
      { type: 'tool_call_request', name: 'read_file' },
      msg('user_message', '问题'),
      { type: 'tool_result', name: 'read_file', success: true, content: '文件内容' },
      msg('assistant_message', '回答'),
      { type: 'context_compression', beforeTokens: 100, afterTokens: 50 },
      { type: 'summary_saved', level: 1, content: '摘要' },
    ])
    expect(res.replayed).toBe(2)
    expect(r.calls.filter((c) => c.kind !== 'system')).toHaveLength(2)
    expect(r.calls.map((c) => c.content)).not.toContain('文件内容')
  })

  it('超过上限时保留最近 N 条并报告截断数', () => {
    const r = makeRecorder()
    const events = Array.from({ length: REPLAY_MAX_MESSAGES + 10 }, (_, i) =>
      msg(i % 2 === 0 ? 'user_message' : 'assistant_message', `消息${i}`),
    )
    const res = replaySessionContext(r, events)
    expect(res.truncated).toBe(10)
    expect(res.replayed).toBe(REPLAY_MAX_MESSAGES)
    // 截断提示在最前，且最先被截掉的消息不在回放里
    expect(r.calls[0].content).toContain('10 条消息未回放')
    expect(r.calls.map((c) => c.content)).not.toContain('消息9')
    expect(r.calls.some((c) => c.content === '消息49')).toBe(true)
  })

  it('恰好等于上限时不产生截断提示', () => {
    const r = makeRecorder()
    const events = Array.from({ length: REPLAY_MAX_MESSAGES }, (_, i) => msg('user_message', `m${i}`))
    const res = replaySessionContext(r, events)
    expect(res.truncated).toBe(0)
    expect(res.replayed).toBe(REPLAY_MAX_MESSAGES)
    expect(r.calls[0].kind).toBe('user')
  })

  it('空会话 / 无对话事件：不触碰上下文', () => {
    const r = makeRecorder()
    expect(replaySessionContext(r, [])).toEqual({ replayed: 0, truncated: 0 })
    expect(replaySessionContext(r, [{ type: 'context_compression' }])).toEqual({ replayed: 0, truncated: 0 })
    expect(r.calls).toHaveLength(0)
  })

  it('容错：type/content 缺失或类型异常不抛错', () => {
    const r = makeRecorder()
    const res = replaySessionContext(r, [
      {},
      { type: 42, content: '数字类型' },
      { type: 'user_message', content: 123 },
      msg('user_message', '正常消息'),
    ] as unknown as ReplayEvent[])
    expect(res.replayed).toBe(1)
    expect(r.calls[0].content).toBe('正常消息')
  })
})
