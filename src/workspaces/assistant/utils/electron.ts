// AI 助手 IPC 适配层（沿用各 workspace 自带 utils/electron 的约定）：
// 非 Electron（纯 Web）环境回退 mock，避免 window.electronAPI 可选声明下的 undefined。

export interface AssistantBridge {
  start: (options: {
    models: AssistantModelConfig[]
    schedulerEnabled?: boolean
    approvalEnabled?: boolean
    /** 注入的工具箱工具名（缺省注册全部 toolbox_*） */
    extraToolNames?: string[]
    /** 三段式权限清单（切片 E）：needsApproval 强制审批，disabled 不注册 */
    policy?: {
      needsApproval?: string[]
      disabled?: string[]
    }
    port?: number
  }) => Promise<{ success: boolean; error?: string; status: AssistantStatus | null }>
  stop: () => Promise<{ success: boolean; error?: string }>
  status: () => Promise<AssistantStatus>
  run: (message: string) => Promise<{ success: boolean; message: string; error?: string }>
  setModels: (models: unknown[]) => Promise<{ success: boolean; error?: string }>
  switchModel: (name: string) => Promise<boolean>
  providers: () => Promise<string[]>
  /** 审批墙：运行时切换审批模式（切片 D） */
  setApprovalMode: (enabled: boolean) => Promise<{ success: boolean; enabled?: boolean; error?: string }>
  /** 审批墙：对一次审批请求回应批准/拒绝（切片 D） */
  approvalResponse: (id: string, approved: boolean) => Promise<{ success: boolean; error?: string }>
  /** 会话历史（切片 F）：Trajectory 事件流查看 */
  historyList: () => Promise<{
    success: boolean
    error?: string
    sessions: { sessionId: string; file: string; mtimeMs: number; size: number }[]
  }>
  historyRead: (file: string) => Promise<{ success: boolean; error?: string; events: AssistantHistoryEvent[] }>
  historyDelete: (file: string) => Promise<{ success: boolean; error?: string }>
  /** 技能预设进阶（切片 H.2）：工具清单与运行时工具子集 */
  toolsList: () => Promise<{ success: boolean; error?: string; names: string[] }>
  setToolFilter: (names: string[] | null) => Promise<{ success: boolean; error?: string }>
  onEvent: (callback: (e: unknown) => void) => () => void
}

const mockStatus: AssistantStatus = {
  running: false,
  port: null,
  url: null,
  sessionId: null,
  providerNames: [],
  activeProvider: null,
}

const mockAssistant: AssistantBridge = {
  start: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手', status: null }),
  stop: () => Promise.resolve({ success: true }),
  status: () => Promise.resolve(mockStatus),
  run: () => Promise.resolve({ success: false, message: '', error: 'Web 环境不支持 AI 助手' }),
  setModels: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手' }),
  switchModel: () => Promise.resolve(false),
  providers: () => Promise.resolve([]),
  setApprovalMode: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手' }),
  approvalResponse: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手' }),
  historyList: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手', sessions: [] }),
  historyRead: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手', events: [] }),
  historyDelete: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手' }),
  toolsList: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手', names: [] }),
  setToolFilter: () => Promise.resolve({ success: false, error: 'Web 环境不支持 AI 助手' }),
  onEvent: () => () => {},
}

export const assistantAPI: AssistantBridge = window.electronAPI?.assistant ?? mockAssistant
