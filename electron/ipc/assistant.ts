import { ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
// dev-assistant-ts 的 exports["."].default 指向 CLI 入口 dist/main.js（commander，无 App 导出），
// 而 types 指向 dist/app.d.ts —— 包内 types 与运行时入口不一致。
// 这里绕过 exports 映射，按相对路径直接加载真实 ESM 模块 dist/app.js
// （源码与 dist-electron 产物同层级深度，相对路径两侧一致）。
import { App, type AppOptions } from '../../node_modules/dev-assistant-ts/dist/app.js'
import { SessionStore } from '../../node_modules/dev-assistant-ts/dist/persist/session-store.js'
import { getVaultPath } from './vault.js'
import { registerToolboxTools, TOOLBOX_TOOL_NAMES } from './assistant-tools.js'
import { registerKnowledgeTools } from './knowledge-tools.js'

/**
 * AI 助手 IPC（assistant:* 命名空间，对齐设计文档 Phase 6 + 附录 B/C）。
 *
 * 切片 B：改用核心 App（dev-assistant-ts 根导出）替代 embed 门面，
 * 因 embed 未暴露 ToolRegistry；App 公开 readonly tools，启动后经
 * registerToolboxTools 注入工具箱纯函数工具（toolbox_*）。
 *
 * 切片 D：审批桥 —— AppOptions.confirmApproval 注入回调，把 ApprovalManager
 * 的确认请求经 assistant:events 广播 approvalRequest，渲染端「审批墙」
 * 批准/拒绝后经 assistant:approvalResponse 回传；超时默认拒绝。
 * 审批模式运行时切换走 app.approval.setDisabled（assistant:setApprovalMode）。
 *
 * 主进程持有 App 单例（workingDir 固定为知识库 Vault 路径）：
 * - assistant:start(options)   停止旧实例后按新配置启动（幂等重启）
 * - assistant:stop             停止并释放
 * - assistant:status           运行状态
 * - assistant:run(message)     驱动一次 Agent 完整运行（阻塞至完成）
 * - assistant:setModels        模型配置运行时热替换
 * - assistant:switchModel      切换活跃 provider
 * - assistant:setApprovalMode  审批墙开关（热切换，无需重启）
 * - assistant:approvalResponse 审批墙回传（批准/拒绝）
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

/** 与渲染进程 AssistantStatus 契约保持同形（原 embed 门面 getStatus 结构） */
export interface AssistantStatus {
  running: boolean
  port: number | null
  url: string | null
  sessionId: string | null
  providerNames: string[]
  activeProvider: string | null
}

export interface AssistantStartInput {
  models: AssistantModelInput[]
  schedulerEnabled?: boolean
  approvalEnabled?: boolean
  /** 追加禁用的工具名（在默认安全裁剪之上） */
  extraDisabledTools?: string[]
  /** 注入的工具箱工具名（缺省注册全部 toolbox_*） */
  extraToolNames?: string[]
  /** 三段式权限清单（切片 E，设计 C.3）：缺省用主进程默认值 */
  policy?: {
    needsApproval?: string[]
    disabled?: string[]
  }
}

/** 嵌入式安全基线：默认裁掉任意命令执行面 + 写类工具强制审批 */
const DEFAULT_DISABLED_TOOLS = ['exec_command', 'run_hook']
const DEFAULT_NEEDS_APPROVAL = ['write_file', 'edit_file']

let app: App | null = null

// ---------- 审批桥（切片 D，设计 C.3） ----------

type ConfirmHandler = NonNullable<AppOptions['confirmApproval']>

interface PendingApproval {
  resolve: (approved: boolean) => void
  timer: NodeJS.Timeout
}

const pendingApprovals = new Map<string, PendingApproval>()
let approvalSeq = 0

/**
 * ApprovalManager 的确认回调：把审批请求广播给渲染端审批墙，
 * Promise 挂起直到 assistant:approvalResponse 回传或超时（默认拒绝）。
 */
const confirmApprovalBridge: ConfirmHandler = (requirement, scope) => {
  if (!app) return Promise.resolve(false)
  const id = `approval-${++approvalSeq}`
  return new Promise((resolve) => {
    // 超时默认拒绝：取 requirement.validitySeconds（钳制在 30s~10min），缺省 120s
    const timeoutMs = Math.max(30, Math.min(requirement.validitySeconds || 120, 600)) * 1000
    const timer = setTimeout(() => {
      pendingApprovals.delete(id)
      broadcast({ kind: 'approvalTimeout', id })
      resolve(false)
    }, timeoutMs)
    pendingApprovals.set(id, { resolve, timer })
    broadcast({ kind: 'approvalRequest', id, requirement, scope })
  })
}

/** 技能工具过滤器 setter（随 app 实例重建而更新；app 停止时置 null） */
let setToolFilterImpl: ((names: string[] | null) => void) | null = null

/**
 * 技能预设进阶（切片 H.2）：运行时工具子集过滤。
 * 包装公开的 getToolSchemas（LLM 只见白名单工具）+ execute（执行侧双保险，
 * 同时保证 needsApproval 包装先于过滤判断之外的路径不被绕过）。
 * filter 为 null 时恢复全量。
 */
function installToolFilter(tools: App['tools']) {
  let filter: Set<string> | null = null
  type ExecParams = Parameters<App['tools']['execute']>
  type SchemaParams = Parameters<App['tools']['getToolSchemas']>
  type SchemaReturn = ReturnType<App['tools']['getToolSchemas']>

  const origExecute = tools.execute.bind(tools)
  ;(tools as { execute: (...args: ExecParams) => Promise<Awaited<ReturnType<App['tools']['execute']>>> }).execute =
    async (name, argsJson, context, approval) => {
      if (filter && !filter.has(name)) {
        return {
          success: false,
          content: `当前技能模式仅允许使用工具: ${[...filter].join(', ')}`,
          restartRequested: false,
        }
      }
      return origExecute(name, argsJson, context, approval)
    }

  const origSchemas = tools.getToolSchemas.bind(tools)
  ;(tools as { getToolSchemas: (...args: SchemaParams) => SchemaReturn }).getToolSchemas = (...args) =>
    filter ? origSchemas(...args).filter((s) => filter!.has(s.function.name)) : origSchemas(...args)

  setToolFilterImpl = (names) => {
    filter = names && names.length > 0 ? new Set(names) : null
  }
}

/** 重启/停止时清空所有挂起审批：全部按拒绝处理并广播超时，避免渲染端横幅悬挂 */
function rejectAllPendingApprovals() {
  for (const [id, p] of pendingApprovals) {
    clearTimeout(p.timer)
    pendingApprovals.delete(id)
    broadcast({ kind: 'approvalTimeout', id })
    p.resolve(false)
  }
}

/**
 * 三段式权限清单（切片 E，设计 C.3）：对 needs-approval 名单内的工具做
 * 实例级 execute 包装，执行前强制过审批桥。
 *
 * 不走 registry.register 替换 handler —— ToolRegistry 禁止重复注册且无替换
 * API；这里在公开的 execute 入口外层包一层，对内置与注入工具统一生效。
 * 审批总开关关闭（ApprovalManager disabled）时直接放行，与切片 D 语义一致。
 */
function enforceNeedsApproval(
  tools: App['tools'],
  needsApproval: string[],
  isApprovalEnabled: () => boolean,
) {
  const names = new Set(needsApproval)
  if (names.size === 0) return
  const original = tools.execute.bind(tools)
  type ExecParams = Parameters<App['tools']['execute']>
  const patched = async (
    name: string,
    argsJson: string,
    context: ExecParams[2],
    approval?: ExecParams[3],
  ) => {
    if (names.has(name) && isApprovalEnabled()) {
      const approved = await confirmApprovalBridge(
        {
          approvalType: 'one-time',
          dangerThreshold: 'medium',
          requiresUserConfirmation: true,
          validitySeconds: 120,
          scope: 'file',
        },
        `tool:${name}`,
      )
      if (!approved) {
        return { success: false, content: `用户在审批墙拒绝了工具 ${name} 的执行`, restartRequested: false }
      }
    }
    return original(name, argsJson, context, approval)
  }
  ;(tools as { execute: typeof patched }).execute = patched
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

function broadcast(e: unknown) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('assistant:events', e)
  }
}

function currentStatus(): AssistantStatus {
  return {
    running: app !== null,
    port: null,
    url: null,
    sessionId: app?.sessionId ?? null,
    providerNames: app ? app.llm.providerNames() : [],
    activeProvider: app ? (app.llm.activeConfig()?.name ?? null) : null,
  }
}

function registerAssistantIpc() {
  ipcMain.handle(
    'assistant:start',
    async (_event, options: AssistantStartInput): Promise<{ success: boolean; error?: string; status: AssistantStatus | null }> => {
      const workingDir = getVaultPath()
      if (!workingDir) {
        return { success: false, error: '尚未选择知识库文件夹', status: null }
      }
      if (!Array.isArray(options.models) || options.models.length === 0) {
        return { success: false, error: '未配置任何模型', status: null }
      }
      try {
        if (app) {
          await app.close() // 幂等：支持设置变更后重启
          app = null
        }
        rejectAllPendingApprovals()
        // 三段式清单：disabled 决定注册裁剪面（渲染端未传则用主进程默认）
        const disabledTools = [
          ...(options.policy?.disabled ?? DEFAULT_DISABLED_TOOLS),
          ...(options.extraDisabledTools ?? []),
        ]
        const next = await App.create({
          workingDir,
          models: options.models,
          approvalEnabled: options.approvalEnabled ?? false,
          schedulerEnabled: options.schedulerEnabled ?? true,
          disabledTools,
          confirmApproval: confirmApprovalBridge,
        })
        // 工具箱纯函数工具注入（缺省全部 toolbox_*）；先装技能过滤器再装审批包装
        installToolFilter(next.tools)
        registerToolboxTools(next.tools, options.extraToolNames ?? [...TOOLBOX_TOOL_NAMES])
        // 知识库工具（C.5 进阶版）：Agent 可按路径读取钉选笔记全文
        registerKnowledgeTools(next.tools)
        // needs-approval 清单：执行前强制审批（审批总开关开启时）
        enforceNeedsApproval(
          next.tools,
          options.policy?.needsApproval ?? DEFAULT_NEEDS_APPROVAL,
          () => !next.approval.isDisabled(),
        )
        next.setOnEvent(broadcast)
        app = next
        return { success: true, status: currentStatus() }
      } catch (e) {
        return { success: false, error: errMessage(e), status: null }
      }
    },
  )

  ipcMain.handle('assistant:stop', async () => {
    try {
      if (app) {
        await app.close()
        app = null
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  ipcMain.handle('assistant:status', (): AssistantStatus => currentStatus())

  ipcMain.handle('assistant:run', async (_event, message: string): Promise<AssistantRunResult> => {
    if (!app) return { success: false, message: '', error: '助手未启动' }
    try {
      const r = await app.run(message)
      return { success: r.success, message: r.message }
    } catch (e) {
      return { success: false, message: '', error: errMessage(e) }
    }
  })

  ipcMain.handle('assistant:setModels', async (_event, models: AssistantModelInput[]) => {
    if (!app) return { success: false, error: '助手未启动' }
    try {
      await app.replaceLlm(models)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  ipcMain.handle('assistant:switchModel', (_event, name: string) => {
    return app ? app.llm.setActiveByName(name) : false
  })

  ipcMain.handle('assistant:providers', () => (app ? app.llm.providerNames() : []))

  // 审批墙：运行时热切换（ApprovalManager.setDisabled，无需重启）
  ipcMain.handle('assistant:setApprovalMode', (_event, enabled: boolean) => {
    if (!app) return { success: false, error: '助手未启动' }
    app.approval.setDisabled(!enabled)
    return { success: true, enabled }
  })

  // 审批墙：渲染端批准/拒绝回传
  ipcMain.handle('assistant:approvalResponse', (_event, id: string, approved: boolean) => {
    const pending = pendingApprovals.get(id)
    if (!pending) return { success: false, error: '审批请求不存在或已过期' }
    clearTimeout(pending.timer)
    pendingApprovals.delete(id)
    pending.resolve(Boolean(approved))
    return { success: true }
  })

  // ---------- 会话历史（切片 F，C.8 dsh 借鉴：Trajectory 事件流查看） ----------

  /** 会话存储目录：dev-assistant-ts SessionStore 约定 workingDir/.dev-assistant-store */
  function isSafeSessionFile(file: string): boolean {
    const workingDir = getVaultPath()
    if (!workingDir) return false
    const storeDir = path.resolve(workingDir, '.dev-assistant-store')
    const resolved = path.resolve(file)
    return resolved.startsWith(storeDir + path.sep) && resolved.endsWith('.jsonl')
  }

  ipcMain.handle('assistant:history:list', () => {
    try {
      const workingDir = getVaultPath()
      if (!workingDir) return { success: false, error: '尚未选择知识库文件夹', sessions: [] }
      return { success: true, sessions: SessionStore.listSessions(workingDir) }
    } catch (e) {
      return { success: false, error: errMessage(e), sessions: [] }
    }
  })

  ipcMain.handle('assistant:history:read', async (_event, file: string) => {
    try {
      if (!isSafeSessionFile(file)) return { success: false, error: '非法会话路径', events: [] }
      return { success: true, events: await SessionStore.readEvents(file) }
    } catch (e) {
      return { success: false, error: errMessage(e), events: [] }
    }
  })

  ipcMain.handle('assistant:history:delete', (_event, file: string) => {
    try {
      if (!isSafeSessionFile(file)) return { success: false, error: '非法会话路径' }
      SessionStore.deleteSession(file)
      return { success: true }
    } catch (e) {
      return { success: false, error: errMessage(e) }
    }
  })

  // ---------- 技能预设进阶（切片 H.2）：工具清单与运行时工具子集 ----------

  ipcMain.handle('assistant:tools:list', () => {
    return { success: true, names: app ? app.tools.listNames() : [] }
  })

  ipcMain.handle('assistant:setToolFilter', (_event, names: string[] | null) => {
    if (!app) return { success: false, error: '助手未运行' }
    setToolFilterImpl?.(Array.isArray(names) ? names : null)
    return { success: true }
  })
}

/** 应用退出前释放（main.ts before-quit 调用） */
async function stopAssistant() {
  rejectAllPendingApprovals()
  setToolFilterImpl = null
  if (app) {
    await app.close().catch(() => undefined)
    app = null
  }
}

export { registerAssistantIpc, stopAssistant }
