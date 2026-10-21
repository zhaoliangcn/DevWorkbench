// 附录 F F.4b：Cron 触发调度器测试（主进程侧纯逻辑：任务校验 + 目标执行）
// 调度轮询/持久化/IPC 属模块内部副作用，由 ruleMatches（cron.test.ts）与人工验收覆盖
import { describe, it, expect, beforeEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'dw-cron-scheduler-'))

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 2 })) }, // 默认「始终允许」
  app: { getPath: vi.fn(() => TMP_DIR) },
  // 通知完成回调（notifyTaskDone）：测试仅覆盖 fireTarget，不真正弹通知
  Notification: class {
    on() {}
    show() {}
  },
}))

// F.4c：隔离 Agent/LLM 执行（真实模块依赖 dev-assistant-ts 与 app 启动状态）
vi.mock('../electron/ipc/assistant', () => ({
  runAgentTask: vi.fn(),
  runLlmTask: vi.fn(),
}))

import { validateTasks, fireTarget, type CronTask } from '../electron/ipc/cron'
import { runAgentTask, runLlmTask } from '../electron/ipc/assistant'
import { dialog } from 'electron'

beforeEach(() => {
  vi.mocked(dialog.showMessageBox).mockClear()
})

function makeTask(partial: Partial<CronTask>): CronTask {
  return {
    id: 't1',
    name: '测试任务',
    expr: '*/15 * * * *',
    target: { type: 'http', url: 'https://example.com/hook' },
    enabled: true,
    ...partial,
  }
}

describe('validateTasks（任务清单校验）', () => {
  it('合法清单返回 null', () => {
    const tasks = [
      makeTask({}),
      makeTask({ id: 't2', name: '备份', expr: '0 9 * * 1-5', target: { type: 'script', command: 'backup.sh' } }),
    ]
    expect(validateTasks(tasks)).toBeNull()
  })

  it('空名称拒绝', () => {
    expect(validateTasks([makeTask({ name: ' ' })])).toContain('名称')
  })

  it('非法表达式拒绝且带上任务名', () => {
    const err = validateTasks([makeTask({ expr: '0 9 * *' })])
    expect(err).toContain('测试任务')
    expect(err).toContain('5 个字段')
  })

  it('HTTP 目标需 http(s):// 开头', () => {
    expect(validateTasks([makeTask({ target: { type: 'http', url: 'ftp://x' } })])).toContain('http(s)')
  })

  it('脚本目标命令不能为空', () => {
    expect(validateTasks([makeTask({ target: { type: 'script', command: '  ' } })])).toContain('命令')
  })

  it('脚本自定义超时：合法值通过，越界值拒绝', () => {
    expect(validateTasks([makeTask({ target: { type: 'script', command: 'x', timeoutMs: 600_000 } })])).toBeNull()
    expect(validateTasks([makeTask({ target: { type: 'script', command: 'x', timeoutMs: 500 } })])).toContain('超时')
    expect(validateTasks([makeTask({ target: { type: 'script', command: 'x', timeoutMs: 1_800_001 } })])).toContain('超时')
    expect(validateTasks([makeTask({ target: { type: 'script', command: 'x', timeoutMs: 1.5 } })])).toContain('超时')
  })

  it('Agent 目标提示词不能为空（F.4c）', () => {
    expect(validateTasks([makeTask({ target: { type: 'agent', prompt: ' ' } })])).toContain('提示词')
  })

  it('LLM 目标空提示词拒绝', () => {
    expect(validateTasks([makeTask({ target: { type: 'llm', prompt: ' ' } })])).toContain('提示词')
    expect(validateTasks([makeTask({ target: { type: 'llm', prompt: '总结本周笔记' } })])).toBeNull()
  })
})

describe('fireTarget（目标执行）', () => {
  it('HTTP：成功时 detail 含状态码与耗时', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('ok', { status: 200, statusText: 'OK' })),
    )
    const r = await fireTarget({ type: 'http', url: 'https://example.com/hook' })
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('200')
    expect(r.detail).toContain('ms')
  })

  it('HTTP：网络失败时 ok=false 且 detail 含错误', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ECONNREFUSED') }))
    const r = await fireTarget({ type: 'http', url: 'https://example.com/hook' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('ECONNREFUSED')
  })

  it('脚本：echo 输出进入 detail（确认框返回「始终允许」）', async () => {
    const r = await fireTarget({ type: 'script', command: 'echo hello-cron' })
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('hello-cron')
  })

  it('脚本：确认框取消则跳过执行', async () => {
    vi.mocked(dialog.showMessageBox).mockResolvedValueOnce({ response: 0 } as never)
    const r = await fireTarget({ type: 'script', command: 'echo cancelled-cron' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('未获确认')
    expect(dialog.showMessageBox).toHaveBeenCalledTimes(1)
  })

  it('脚本：非零退出码 ok=false，detail 含 exit', async () => {
    const r = await fireTarget({ type: 'script', command: 'exit 3' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('exit=3')
  })

  it('脚本：自定义 timeoutMs 生效，超时命令被终止', async () => {
    const r = await fireTarget({ type: 'script', command: 'node -e "setTimeout(()=>{},60000)"', timeoutMs: 1000 })
    expect(r.ok).toBe(false)
  }, 10_000)

  it('脚本：自定义 timeoutMs 下快速命令正常完成', async () => {
    const r = await fireTarget({ type: 'script', command: 'echo fast-cron', timeoutMs: 60_000 })
    expect(r.ok).toBe(true)
    expect(r.detail).toContain('fast-cron')
  })

  it('Agent：转发 runAgentTask 成功结果（F.4c）', async () => {
    vi.mocked(runAgentTask).mockResolvedValueOnce({ ok: true, detail: '任务完成' })
    const r = await fireTarget({ type: 'agent', prompt: '生成摘要' })
    expect(r.ok).toBe(true)
    expect(r.detail).toBe('任务完成')
    expect(runAgentTask).toHaveBeenCalledWith('生成摘要')
  })

  it('Agent：失败结果透传（F.4c）', async () => {
    vi.mocked(runAgentTask).mockResolvedValueOnce({ ok: false, detail: '助手未启动' })
    const r = await fireTarget({ type: 'agent', prompt: '生成摘要' })
    expect(r.ok).toBe(false)
    expect(r.detail).toBe('助手未启动')
  })

  it('LLM：转发 runLlmTask 成功结果（F.4c）', async () => {
    vi.mocked(runLlmTask).mockResolvedValueOnce({ ok: true, detail: '本周共新增 3 篇笔记' })
    const r = await fireTarget({ type: 'llm', prompt: '总结本周笔记' })
    expect(r.ok).toBe(true)
    expect(r.detail).toBe('本周共新增 3 篇笔记')
    expect(runLlmTask).toHaveBeenCalledWith('总结本周笔记')
  })

  it('LLM：失败结果透传（F.4c）', async () => {
    vi.mocked(runLlmTask).mockResolvedValueOnce({ ok: false, detail: '助手未启动（需在 AI 助手页启动并配置模型）' })
    const r = await fireTarget({ type: 'llm', prompt: '总结本周笔记' })
    expect(r.ok).toBe(false)
    expect(r.detail).toContain('助手未启动')
  })
})
