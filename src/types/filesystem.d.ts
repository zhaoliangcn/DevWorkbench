interface FileSystemHandlePermissionDescriptor {
  mode?: 'read' | 'readwrite'
}

interface FileSystemDirectoryHandle {
  name: string
  kind: 'directory'
  queryPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  requestPermission(descriptor?: FileSystemHandlePermissionDescriptor): Promise<PermissionState>
  getDirectoryHandle(name: string, options?: { create?: boolean }): Promise<FileSystemDirectoryHandle>
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandle>
  removeEntry(name: string, options?: { recursive?: boolean }): Promise<void>
  entries(): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
  [Symbol.asyncIterator](): AsyncIterableIterator<[string, FileSystemDirectoryHandle | FileSystemFileHandle]>
}

interface FileSystemFileHandle {
  name: string
  kind: 'file'
  getFile(): Promise<File>
  createWritable(options?: { keepExistingData?: boolean }): Promise<FileSystemWritableFileStream>
}

interface FileSystemWritableFileStream extends WritableStream {
  write(data: string | Blob | ArrayBuffer | ArrayBufferView): Promise<void>
  seek(position: number): Promise<void>
  truncate(size: number): Promise<void>
}

interface Window {
  showDirectoryPicker(options?: {
    mode?: 'read' | 'readwrite'
  }): Promise<FileSystemDirectoryHandle>
  electronAPI?: ElectronAPI
}

interface ElectronAPI {
  app: {
    getVersion: () => Promise<string>
    getPlatform: () => Promise<{ platform: string; arch: string; homedir: string }>
  }
  vault: {
    getPath: () => Promise<string | null>
    getName: () => Promise<string | null>
    select: () => Promise<{ path: string; name: string } | null>
  }
  file: {
    read: (relativePath: string) => Promise<string | null>
    write: (relativePath: string, content: string) => Promise<void>
    delete: (relativePath: string) => Promise<void>
    list: () => Promise<{ path: string; name: string; content: string }[]>
    export: (relativePath: string, content: string) => Promise<void>
  }
  dir: {
    list: () => Promise<string[]>
    create: (relativePath: string) => Promise<void>
    delete: (relativePath: string) => Promise<void>
  }
  ssh: {
    connect: (
      connectionId: string,
      config: { host: string; port: number; username: string; password?: string; privateKey?: string },
    ) => Promise<{ success: boolean; error?: string }>
    disconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>
    exec: (connectionId: string, command: string) => Promise<{
      success: boolean
      stdout?: string
      stderr?: string
      code?: number
      error?: string
    }>
    openShell: (connectionId: string, cols: number, rows: number) => Promise<{ success: boolean }>
    shellWrite: (connectionId: string, data: string) => Promise<{ success: boolean; error?: string }>
    shellResize: (connectionId: string, cols: number, rows: number) => Promise<{ success: boolean }>
    onShellData: (connectionId: string, callback: (data: string) => void) => void
    onShellError: (connectionId: string, callback: (error: string) => void) => void
    onShellClose: (connectionId: string, callback: () => void) => void
  }
  system: {
    checkEnv: (envType: string) => Promise<{ name: string; installed: boolean; version?: string }>
    checkPort: {
      (port: number): Promise<{
        port: number
        protocol: string
        pid?: number
        processName?: string
        state?: string
      } | null>
      (port: number, host: string): Promise<boolean>
    }
    getLocalIps: () => Promise<string[]>
    killProcess: (pid: number) => Promise<boolean>
    checkMirror: (url: string) => Promise<{
      url: string
      available: boolean
      statusCode: number | null
      responseTime: number
      error?: string
    }>
  }
  data: {
    save: (key: string, data: unknown) => Promise<boolean>
    load: (key: string) => Promise<unknown>
    delete: (key: string) => Promise<boolean>
  }
  assistant: {
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
}

interface AssistantStatus {
  running: boolean
  port: number | null
  url: string | null
  sessionId: string | null
  providerNames: string[]
  activeProvider: string | null
}

/** 会话历史事件（切片 F，对齐 dev-assistant-ts SessionEvent 结构化子集） */
interface AssistantHistoryEvent {
  type:
    | 'user_message'
    | 'assistant_message'
    | 'system_message'
    | 'tool_call_request'
    | 'tool_result'
    | 'context_compression'
    | 'summary_saved'
  timestamp: string
  content?: string
  name?: string
  success?: boolean
  arguments?: unknown
  beforeTokens?: number
  afterTokens?: number
  level?: number
}

interface AssistantModelConfig {
  name: string
  provider: 'openai' | 'openai-compatible' | 'ollama'
  apiUrl: string
  apiKey: string
  model: string
  temperature: number
  maxOutputTokens: number
}
