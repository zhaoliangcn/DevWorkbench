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
    /** vault 监听（附录 E E.3.6）：外部文件变更推送；返回取消订阅函数 */
    onChanged: (
      callback: (change: { relPath: string; kind: 'add' | 'change' | 'unlink' }) => void,
    ) => () => void
  }
  trash: {
    list: () => Promise<{ relPath: string; name: string; mtime: number }[]>
    restore: (relPath: string) => Promise<{ path: string }>
    purge: (relPath: string) => Promise<void>
  }
  file: {
    read: (relativePath: string) => Promise<string | null>
    write: (relativePath: string, content: string) => Promise<void>
    /** 二进制附件通道（附录 E E.3.5）：base64 传输 */
    writeBinary: (relativePath: string, base64: string) => Promise<void>
    readBinary: (relativePath: string) => Promise<string | null>
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
    listProcesses: () => Promise<{ success: boolean; raw: string; kind: string; error?: string }>
    checkMirror: (url: string) => Promise<{
      url: string
      available: boolean
      statusCode: number | null
      responseTime: number
      error?: string
    }>
  }
  docker: {
    /** 附录 B.6.1：Docker 管理面板 */
    check: () => Promise<{ available: boolean; version?: string; error?: string }>
    containers: () => Promise<{ success: boolean; raw: string; error?: string }>
    images: () => Promise<{ success: boolean; raw: string; error?: string }>
    logs: (id: string, tail?: number) => Promise<{ success: boolean; logs: string; error?: string }>
    action: (action: string, id: string) => Promise<{ success: boolean; error?: string }>
  }
  envfile: {
    /** 附录 B.6.3：.env 管理器 */
    pick: () => Promise<{
      success: boolean
      canceled: boolean
      files: { path: string; name: string }[]
    }>
    read: (filePath: string) => Promise<{ success: boolean; raw: string; error?: string }>
  }
  secvault: {
    /** 附录 B.7：凭据保险库 */
    status: () => Promise<{ initialized: boolean; entryCount: number }>
    init: (password: string) => Promise<{ success: boolean; error?: string }>
    verify: (password: string) => Promise<{
      success: boolean
      verified: boolean
      error?: string
    }>
    list: (password: string) => Promise<{
      success: boolean
      entries: { id: string; name: string; kind: string; createdAt: string }[]
      error?: string
    }>
    get: (password: string, id: string) => Promise<{
      success: boolean
      value: string
      error?: string
    }>
    put: (
      password: string,
      payload: { id?: string; name: string; kind: string; value: string }
    ) => Promise<{ success: boolean; error?: string }>
    del: (password: string, id: string) => Promise<{ success: boolean; error?: string }>
  }
  http: {
    /** 附录 F F.2：HTTP 请求经主进程发出（绕 CORS），二进制响应 base64 回传 */
    request: (args: {
      url: string
      method?: string
      headers?: Record<string, string>
      body?: string
      timeoutMs?: number
    }) => Promise<{
      success: boolean
      status: number | null
      statusText: string
      headers: Record<string, string>
      /** 文本为 utf8 原文；二进制为 base64（bodyIsBase64=true） */
      body: string
      bodyIsBase64: boolean
      durationMs: number
      error?: string
    }>
  }
  webhook: {
    /** 附录 F F.3：Webhook 接收器 */
    list: () => Promise<{
      listening: boolean
      port: number | null
      enabled: boolean
      events: {
        id: string
        method: string
        path: string
        headers: Record<string, string>
        body: string
        receivedAt: number
      }[]
    }>
    setEnabled: (enabled: boolean) => Promise<{
      listening: boolean
      port: number | null
      enabled: boolean
      error?: string
    }>
    clear: () => Promise<boolean>
    /** 实时推送订阅；返回取消订阅函数 */
    onReceived: (callback: (ev: {
      id: string
      method: string
      path: string
      headers: Record<string, string>
      body: string
      receivedAt: number
    }) => void) => () => void
  }
  cron: {
    /** 附录 F F.4b：Cron 触发调度器 */
    getTasks: () => Promise<{
      tasks: {
        id: string
        name: string
        expr: string
        target:
          | { type: 'http'; url: string; method?: string; headers?: Record<string, string>; body?: string }
          | { type: 'script'; command: string }
          | { type: 'agent'; prompt: string }
        enabled: boolean
        lastRunAt?: number
      }[]
      logs: {
        id: string
        taskId: string
        taskName: string
        target: string
        ok: boolean
        detail: string
        at: number
      }[]
    }>
    setTasks: (tasks: unknown[]) => Promise<{ success: boolean; error?: string }>
    trigger: (taskId: string) => Promise<{ success: boolean; error?: string }>
    clearLogs: () => Promise<boolean>
    /** 触发日志实时推送订阅；返回取消订阅函数 */
    onLog: (callback: (entry: {
      id: string
      taskId: string
      taskName: string
      target: string
      ok: boolean
      detail: string
      at: number
    }) => void) => () => void
  }
  redis: {
    /** 附录 F F.5：Redis 客户端 */
    connect: (args: { id: string; host: string; port: number; password?: string; db?: number }) => Promise<{
      success: boolean
      version?: string
      error?: string
    }>
    exec: (id: string, command: string) => Promise<{
      success: boolean
      value?: unknown
      elapsedMs?: number
      error?: string
    }>
    scan: (id: string, cursor: string, match: string, count: number) => Promise<{
      success: boolean
      cursor?: string
      keys?: string[]
      error?: string
    }>
    disconnect: (id: string) => Promise<{ success: boolean }>
  }
  sqlite: {
    /** 附录 F F.6：SQLite 浏览器 */
    check: () => Promise<{ available: boolean; error?: string }>
    open: () => Promise<{ success: boolean; canceled?: boolean; filePath?: string; name?: string; error?: string }>
    tables: () => Promise<{ success: boolean; tables?: { name: string; type: string }[]; error?: string }>
    columns: (table: string) => Promise<{ success: boolean; columns?: { name: string; type: string; pk: boolean }[]; error?: string }>
    rows: (table: string, where: string, page: number) => Promise<{
      success: boolean
      rows?: Record<string, unknown>[]
      columns?: string[]
      total?: number
      page?: number
      pageSize?: number
      error?: string
    }>
    exec: (sql: string) => Promise<{
      success: boolean
      rows?: Record<string, unknown>[]
      columns?: string[]
      changes?: number
      error?: string
    }>
    close: () => Promise<{ success: boolean }>
  }
  iconconvert: {
    /** 工具箱：图标格式转换 */
    open: () => Promise<
      | { canceled: true }
      | {
          canceled: false
          path: string
          name: string
          size: number
          format: 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'ico' | 'icns'
          width: number
          height: number
          previewDataUrl: string
        }
    >
    generate: (args: { path: string; target: 'ico' | 'icns' | 'png'; sizes?: number[] }) => Promise<{
      items: { name: string; size: number | null; base64: string; dataUrl: string }[]
      suggestedName: string
    }>
    save: (args: { items: { name: string; base64: string }[]; defaultDir?: string }) => Promise<{
      canceled: boolean
      saved: string[]
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
      /** 工作目录（缺省跟随知识库 Vault）；会话/任务存于该目录下 */
      workingDir?: string
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
    /** 工作目录：弹出系统对话框选择（返回 canceled/path） */
    pickWorkingDir: () => Promise<{ success: boolean; canceled: boolean; path: string }>
    /** 会话历史（切片 F）：Trajectory 事件流查看；workingDir 缺省跟随知识库 Vault */
    historyList: (workingDir?: string) => Promise<{
      success: boolean
      error?: string
      sessions: { sessionId: string; file: string; mtimeMs: number; size: number }[]
    }>
    historyRead: (file: string, workingDir?: string) => Promise<{ success: boolean; error?: string; events: AssistantHistoryEvent[] }>
    historyDelete: (file: string, workingDir?: string) => Promise<{ success: boolean; error?: string }>
    historySearch: (query: string, workingDir?: string) => Promise<{
      success: boolean
      error?: string
      results: { sessionId: string; file: string; mtimeMs: number; hits: { timestamp: string; type: string; snippet: string }[] }[]
    }>
    /** 技能预设进阶（切片 H.2）：工具清单与运行时工具子集 */
    toolsList: () => Promise<{ success: boolean; error?: string; names: string[] }>
    setToolFilter: (names: string[] | null) => Promise<{ success: boolean; error?: string }>
    onEvent: (callback: (e: unknown) => void) => () => void
  }
  explorer: {
    /** 开发助手：项目文件浏览与编辑；root+rel 每次传参，主进程校验路径不越界 */
    pickRoot: () => Promise<{
      success: boolean
      canceled: boolean
      root: string | null
      name: string | null
    }>
    list: (root: string, rel: string) => Promise<{ success: boolean; entries?: ExplorerEntry[]; error?: string }>
    read: (root: string, rel: string) => Promise<ExplorerReadResult>
    readBinary: (root: string, rel: string) => Promise<{
      success: boolean
      mime?: string
      base64?: string
      size?: number
      mtime?: number
      error?: string
    }>
    write: (root: string, rel: string, content: string) => Promise<{
      success: boolean
      size?: number
      mtime?: number
      error?: string
    }>
    stat: (root: string, rel: string) => Promise<{
      success: boolean
      kind?: 'file' | 'dir'
      size?: number
      mtime?: number
      error?: string
    }>
    mkdir: (root: string, rel: string) => Promise<{ success: boolean; error?: string }>
    createFile: (root: string, rel: string) => Promise<{ success: boolean; error?: string }>
    rename: (root: string, rel: string, newName: string) => Promise<{ success: boolean; error?: string }>
    delete: (root: string, rel: string) => Promise<{ success: boolean; error?: string }>
  }
}

/** explorer:list 目录条目（relPath 相对项目根，'/' 分隔） */
interface ExplorerEntry {
  name: string
  relPath: string
  kind: 'file' | 'dir'
  size: number
}

/** explorer:read 结果：text 可编辑 / binary 二进制（非图片走占位）/ tooLarge 超文本上限 */
interface ExplorerReadResult {
  success: boolean
  kind?: 'text' | 'binary' | 'tooLarge'
  content?: string
  size?: number
  mtime?: number
  error?: string
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
