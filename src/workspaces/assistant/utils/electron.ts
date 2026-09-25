// AI 助手 IPC 适配层（沿用各 workspace 自带 utils/electron 的约定）：
// 非 Electron（纯 Web）环境回退 mock，避免 window.electronAPI 可选声明下的 undefined。

export interface AssistantBridge {
  start: (options: {
    models: AssistantModelConfig[]
    schedulerEnabled?: boolean
    approvalEnabled?: boolean
    port?: number
  }) => Promise<{ success: boolean; error?: string; status: AssistantStatus | null }>
  stop: () => Promise<{ success: boolean; error?: string }>
  status: () => Promise<AssistantStatus>
  run: (message: string) => Promise<{ success: boolean; message: string; error?: string }>
  setModels: (models: unknown[]) => Promise<{ success: boolean; error?: string }>
  switchModel: (name: string) => Promise<boolean>
  providers: () => Promise<string[]>
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
  onEvent: () => () => {},
}

export const assistantAPI: AssistantBridge = window.electronAPI?.assistant ?? mockAssistant
