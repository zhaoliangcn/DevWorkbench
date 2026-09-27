import { contextBridge, ipcRenderer } from 'electron'

// Phase 1：各命名空间的 API 桩。
// 实际 handler 在 Phase 2（知识库）与 Phase 3（工具箱）中于主进程实现。
// 这里按设计文档 6.3 的分组暴露，保证渲染进程接口稳定。

const api = {
  app: {
    getVersion: () => ipcRenderer.invoke('app:getVersion'),
    getPlatform: () => ipcRenderer.invoke('app:getPlatform'),
  },
  vault: {
    getPath: () => ipcRenderer.invoke('vault:getPath'),
    getName: () => ipcRenderer.invoke('vault:getName'),
    select: () => ipcRenderer.invoke('vault:select'),
    /** vault 监听（附录 E E.3.6）：外部文件变更推送；返回取消订阅函数 */
    onChanged: (callback: (change: { relPath: string; kind: 'add' | 'change' | 'unlink' }) => void) => {
      const listener = (_event: unknown, change: { relPath: string; kind: 'add' | 'change' | 'unlink' }) =>
        callback(change)
      ipcRenderer.on('vault:changed', listener)
      return () => ipcRenderer.removeListener('vault:changed', listener)
    },
  },
  trash: {
    list: () => ipcRenderer.invoke('trash:list') as Promise<{ relPath: string; name: string; mtime: number }[]>,
    restore: (relPath: string) => ipcRenderer.invoke('trash:restore', relPath) as Promise<{ path: string }>,
    purge: (relPath: string) => ipcRenderer.invoke('trash:purge', relPath),
  },
  file: {
    read: (relativePath: string) => ipcRenderer.invoke('file:read', relativePath),
    write: (relativePath: string, content: string) => ipcRenderer.invoke('file:write', relativePath, content),
    writeBinary: (relativePath: string, base64: string) => ipcRenderer.invoke('file:writeBinary', relativePath, base64),
    readBinary: (relativePath: string) => ipcRenderer.invoke('file:readBinary', relativePath),
    delete: (relativePath: string) => ipcRenderer.invoke('file:delete', relativePath),
    list: () => ipcRenderer.invoke('file:list'),
    export: (relativePath: string, content: string) => ipcRenderer.invoke('file:export', relativePath, content),
  },
  dir: {
    list: () => ipcRenderer.invoke('dir:list'),
    create: (relativePath: string) => ipcRenderer.invoke('dir:create', relativePath),
    delete: (relativePath: string) => ipcRenderer.invoke('dir:delete', relativePath),
  },
  ssh: {
    connect: (connectionId: string, config: Record<string, unknown>) => ipcRenderer.invoke('ssh:connect', connectionId, config),
    disconnect: (connectionId: string) => ipcRenderer.invoke('ssh:disconnect', connectionId),
    exec: (connectionId: string, command: string) => ipcRenderer.invoke('ssh:exec', connectionId, command),
    openShell: (connectionId: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:openShell', connectionId, cols, rows),
    shellWrite: (connectionId: string, data: string) => ipcRenderer.invoke('ssh:shellWrite', connectionId, data),
    shellResize: (connectionId: string, cols: number, rows: number) => ipcRenderer.invoke('ssh:shellResize', connectionId, cols, rows),
    onShellData: (connectionId: string, callback: (data: string) => void) => {
      ipcRenderer.on('ssh:shellData', (_event, id: string, data: string) => {
        if (id === connectionId) callback(data)
      })
    },
    onShellError: (connectionId: string, callback: (error: string) => void) => {
      ipcRenderer.on('ssh:shellError', (_event, id: string, error: string) => {
        if (id === connectionId) callback(error)
      })
    },
    onShellClose: (connectionId: string, callback: () => void) => {
      ipcRenderer.on('ssh:shellClose', (_event, id: string) => {
        if (id === connectionId) callback()
      })
    },
  },
  system: {
    checkEnv: (envType: string) => ipcRenderer.invoke('system:checkEnv', envType),
    checkPort: (port: number, host?: string) => ipcRenderer.invoke('system:checkPort', port, host),
    getLocalIps: () => ipcRenderer.invoke('system:getLocalIps'),
    killProcess: (pid: number) => ipcRenderer.invoke('system:killProcess', pid),
    checkMirror: (url: string) => ipcRenderer.invoke('system:checkMirror', url),
  },
  http: {
    /** 附录 F F.2：HTTP 请求经主进程发出（绕 CORS），二进制响应 base64 回传 */
    request: (args: { url: string; method?: string; headers?: Record<string, string>; body?: string; timeoutMs?: number }) =>
      ipcRenderer.invoke('http:request', args),
  },
  webhook: {
    /** 附录 F F.3：Webhook 接收器 */
    list: () => ipcRenderer.invoke('webhook:list'),
    setEnabled: (enabled: boolean) => ipcRenderer.invoke('webhook:setEnabled', enabled),
    clear: () => ipcRenderer.invoke('webhook:clear'),
    onReceived: (callback: (ev: unknown) => void) => {
      const listener = (_event: unknown, ev: unknown) => callback(ev)
      ipcRenderer.on('webhook:received', listener)
      return () => ipcRenderer.removeListener('webhook:received', listener)
    },
  },
  cron: {
    /** 附录 F F.4b：Cron 触发调度器（HTTP/脚本目标；Agent 目标 F.4c 接入） */
    getTasks: () => ipcRenderer.invoke('cron:tasks:get'),
    setTasks: (tasks: unknown[]) => ipcRenderer.invoke('cron:tasks:set', tasks),
    trigger: (taskId: string) => ipcRenderer.invoke('cron:trigger', taskId),
    clearLogs: () => ipcRenderer.invoke('cron:logs:clear'),
    onLog: (callback: (entry: unknown) => void) => {
      const listener = (_event: unknown, entry: unknown) => callback(entry)
      ipcRenderer.on('cron:log', listener)
      return () => ipcRenderer.removeListener('cron:log', listener)
    },
  },
  redis: {
    /** 附录 F F.5：Redis 客户端（ioredis 常驻主进程） */
    connect: (args: { id: string; host: string; port: number; password?: string; db?: number }) =>
      ipcRenderer.invoke('redis:connect', args),
    exec: (id: string, command: string) => ipcRenderer.invoke('redis:exec', id, command),
    scan: (id: string, cursor: string, match: string, count: number) =>
      ipcRenderer.invoke('redis:scan', id, cursor, match, count),
    disconnect: (id: string) => ipcRenderer.invoke('redis:disconnect', id),
  },
  sqlite: {
    /** 附录 F F.6：SQLite 浏览器（better-sqlite3 主进程单例） */
    check: () => ipcRenderer.invoke('sqlite:check'),
    open: () => ipcRenderer.invoke('sqlite:open'),
    tables: () => ipcRenderer.invoke('sqlite:tables'),
    columns: (table: string) => ipcRenderer.invoke('sqlite:columns', table),
    rows: (table: string, where: string, page: number) => ipcRenderer.invoke('sqlite:rows', table, where, page),
    exec: (sql: string) => ipcRenderer.invoke('sqlite:exec', sql),
    close: () => ipcRenderer.invoke('sqlite:close'),
  },
  data: {
    save: (key: string, data: unknown) => ipcRenderer.invoke('data:save', key, data),
    load: (key: string) => ipcRenderer.invoke('data:load', key),
    delete: (key: string) => ipcRenderer.invoke('data:delete', key),
  },
  assistant: {
    start: (options: {
      models: Array<{
        name: string
        provider: 'openai' | 'openai-compatible' | 'ollama'
        apiUrl: string
        apiKey?: string
        model: string
        temperature?: number
        maxOutputTokens?: number
      }>
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
    }) => ipcRenderer.invoke('assistant:start', options),
    stop: () => ipcRenderer.invoke('assistant:stop'),
    status: () => ipcRenderer.invoke('assistant:status'),
    run: (message: string) => ipcRenderer.invoke('assistant:run', message),
    setModels: (models: unknown[]) => ipcRenderer.invoke('assistant:setModels', models),
    switchModel: (name: string) => ipcRenderer.invoke('assistant:switchModel', name),
    providers: () => ipcRenderer.invoke('assistant:providers'),
    /** 审批墙：运行时切换审批模式（切片 D） */
    setApprovalMode: (enabled: boolean) => ipcRenderer.invoke('assistant:setApprovalMode', enabled),
    /** 审批墙：对一次审批请求回应批准/拒绝（切片 D） */
    approvalResponse: (id: string, approved: boolean) =>
      ipcRenderer.invoke('assistant:approvalResponse', id, approved),
    // 会话历史（切片 F）
    historyList: () => ipcRenderer.invoke('assistant:history:list'),
    historyRead: (file: string) => ipcRenderer.invoke('assistant:history:read', file),
    historyDelete: (file: string) => ipcRenderer.invoke('assistant:history:delete', file),
    // 技能预设进阶（切片 H.2）
    toolsList: () => ipcRenderer.invoke('assistant:tools:list'),
    setToolFilter: (names: string[] | null) => ipcRenderer.invoke('assistant:setToolFilter', names),
    onEvent: (callback: (e: unknown) => void) => {
      const listener = (_event: unknown, e: unknown) => callback(e)
      ipcRenderer.on('assistant:events', listener)
      return () => ipcRenderer.removeListener('assistant:events', listener)
    },
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
