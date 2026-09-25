import { ipcMain, BrowserWindow } from 'electron'
import { getVaultPath } from './vault.js'
import {
  createAssistantModule,
  type AssistantModule,
  type AssistantStartOptions,
  type AssistantStatus,
  type AgentEvent,
} from 'dev-assistant-ts/embed'

/**
 * AI 助手 IPC（assistant:* 命名空间，对齐设计文档 Phase 6 + 附录 B）。
 *
 * 主进程持有 AssistantModule 单例（workingDir 固定为知识库 Vault 路径）：
 * - assistant:start(options)   停止旧实例后按新配置启动（幂等重启）
 * - assistant:stop             停止并释放
 * - assistant:status           运行状态
 * - assistant:run(message)     驱动一次 Agent 完整运行（阻塞至完成）
 * - assistant:setModels        模型配置运行时热替换
 * - assistant:switchModel      切换活跃 provider
 * - 事件经 assistant:events 广播到所有窗口（渲染进程流式渲染）
 */

export interface AssistantModelInput {
  name: string
  provider: 'openai' | 'openai-compatible' | 'ollama'
  apiUrl: string
  apiKey?: string
  model: string
  temperature?: number
  maxOutputTokens?: number
}

export interface AssistantRunResult {
  success: boolean
  message: string
  error?: string
}

type AssistantStartInput = Omit<AssistantStartOptions, 'workingDir' | 'disabledTools'> & {
  models: AssistantModelInput[]
  /** 追加禁用的工具名（在默认安全裁剪之上） */
  extraDisabledTools?: string[]
}

/** 嵌入式安全基线：approvalEnabled 默认 false（自动审批），必须同时裁掉任意命令执行面 */
const DEFAULT_DISABLED_TOOLS = ['exec_command', 'run_hook']

let mod: AssistantModule | null = null

function getMod(): AssistantModule {
  if (!mod) {
    mod = createAssistantModule()
    // 事件广播（订阅一次，随单例生命周期）
    mod.on('event', (e: AgentEvent) => {
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.webContents.send('assistant:events', e)
      }
    })
  }
  return mod
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function registerAssistantIpc() {
  ipcMain.handle(
    'assistant:start',
    async (_event, options: AssistantStartInput) => {
      const workingDir = getVaultPath()
      if (!workingDir) {
        return { success: false, error: '尚未选择知识库文件夹', status: null as AssistantStatus | null }
      }
      if (!Array.isArray(options.models) || options.models.length === 0) {
        return { success: false, error: '未配置任何模型', status: null as AssistantStatus | null }
      }
      try {
        const m = getMod()
        await m.stop() // 幂等：支持设置变更后重启
        await m.start({
          ...options,
          workingDir,
          disabledTools: [...DEFAULT_DISABLED_TOOLS, ...(options.extraDisabledTools ?? [])],
        })
        return { success: true, status: m.getStatus() }
      } catch (e) {
        return { success: false, error: errMessage(e), status: null as AssistantStatus | null }
      }
    },
  )

  ipcMain.handle('assistant:stop', async () => {
    try {
      await getMod().stop()
      return { success: true }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  ipcMain.handle('assistant:status', () => getMod().getStatus())

  ipcMain.handle('assistant:run', async (_event, message: string): Promise<AssistantRunResult> => {
    try {
      const result = await getMod().run(message)
      return { success: result.success, message: result.message }
    } catch (e) {
      return { success: false, message: '', error: errMessage(e) }
    }
  })

  ipcMain.handle('assistant:setModels', async (_event, models: AssistantModelInput[]) => {
    try {
      await getMod().setModels(models)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  ipcMain.handle('assistant:switchModel', (_event, name: string) => {
    return getMod().switchModel(name)
  })

  ipcMain.handle('assistant:providers', () => getMod().providerNames())
}

/** 应用退出前释放（main.ts before-quit 调用） */
async function stopAssistant() {
  if (mod) {
    await mod.stop().catch(() => undefined)
    mod = null
  }
}

export { registerAssistantIpc, stopAssistant }
