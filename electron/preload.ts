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
    listProcesses: () => ipcRenderer.invoke('system:listProcesses'),
  },
  docker: {
    /** 附录 B.6.1：Docker 管理面板（docker CLI 封装，通道薄返回原始输出） */
    check: () => ipcRenderer.invoke('docker:check'),
    containers: () => ipcRenderer.invoke('docker:containers'),
    images: () => ipcRenderer.invoke('docker:images'),
    logs: (id: string, tail?: number) => ipcRenderer.invoke('docker:logs', id, tail),
    action: (action: string, id: string) => ipcRenderer.invoke('docker:action', action, id),
  },
  envfile: {
    /** 附录 B.6.3：.env 管理器（多选对话框 + 任意路径文本读取） */
    pick: () => ipcRenderer.invoke('envfile:pick'),
    read: (filePath: string) => ipcRenderer.invoke('envfile:read', filePath),
  },
  smb: {
    /** SMB 共享管理（smb:*，Windows net share / Linux smb.conf / macOS sharing） */
    check: () => ipcRenderer.invoke('smb:check'),
    list: () => ipcRenderer.invoke('smb:list'),
    create: (args: { name: string; path: string; remark?: string; readonly?: boolean; users?: string }) =>
      ipcRenderer.invoke('smb:create', args),
    delete: (name: string) => ipcRenderer.invoke('smb:delete', name),
    pickDir: () => ipcRenderer.invoke('smb:pickDir'),
  },
  secvault: {
    /** 附录 B.7：凭据保险库（主进程级 AES-256-GCM 加密存储） */
    status: () => ipcRenderer.invoke('secvault:status'),
    init: (password: string) => ipcRenderer.invoke('secvault:init', password),
    verify: (password: string) => ipcRenderer.invoke('secvault:verify', password),
    list: (password: string) => ipcRenderer.invoke('secvault:list', password),
    get: (password: string, id: string) => ipcRenderer.invoke('secvault:get', password, id),
    put: (
      password: string,
      payload: { id?: string; name: string; kind: string; value: string }
    ) => ipcRenderer.invoke('secvault:put', password, payload),
    del: (password: string, id: string) => ipcRenderer.invoke('secvault:delete', password, id),
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
  iconconvert: {
    /** 工具箱：图标格式转换（iconconvert:*，主进程 nativeImage + 纯 JS ICO/ICNS 容器） */
    open: () => ipcRenderer.invoke('iconconvert:open'),
    generate: (args: { path: string; target: 'ico' | 'icns' | 'png'; sizes?: number[] }) =>
      ipcRenderer.invoke('iconconvert:generate', args),
    save: (args: { items: { name: string; base64: string }[]; defaultDir?: string }) =>
      ipcRenderer.invoke('iconconvert:save', args),
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
    // 工作目录：弹出系统对话框选择（返回 canceled/path）
    pickWorkingDir: () => ipcRenderer.invoke('assistant:pickWorkingDir'),
    // 会话历史（切片 F）：workingDir 缺省跟随知识库 Vault
    historyList: (workingDir?: string) => ipcRenderer.invoke('assistant:history:list', workingDir),
    historyRead: (file: string, workingDir?: string) =>
      ipcRenderer.invoke('assistant:history:read', file, workingDir),
    historyDelete: (file: string, workingDir?: string) =>
      ipcRenderer.invoke('assistant:history:delete', file, workingDir),
    historySearch: (query: string, workingDir?: string) =>
      ipcRenderer.invoke('assistant:history:search', query, workingDir),
    // 技能预设进阶（切片 H.2）
    toolsList: () => ipcRenderer.invoke('assistant:tools:list'),
    setToolFilter: (names: string[] | null) => ipcRenderer.invoke('assistant:setToolFilter', names),
    onEvent: (callback: (e: unknown) => void) => {
      const listener = (_event: unknown, e: unknown) => callback(e)
      ipcRenderer.on('assistant:events', listener)
      return () => ipcRenderer.removeListener('assistant:events', listener)
    },
  },
  explorer: {
    /** 开发助手：项目文件浏览与编辑（explorer:*，root+rel 每次传参 + 主进程路径校验） */
    pickRoot: () => ipcRenderer.invoke('explorer:pickRoot'),
    list: (root: string, rel: string) => ipcRenderer.invoke('explorer:list', root, rel),
    read: (root: string, rel: string) => ipcRenderer.invoke('explorer:read', root, rel),
    readBinary: (root: string, rel: string) => ipcRenderer.invoke('explorer:readBinary', root, rel),
    write: (root: string, rel: string, content: string) =>
      ipcRenderer.invoke('explorer:write', root, rel, content),
    stat: (root: string, rel: string) => ipcRenderer.invoke('explorer:stat', root, rel),
    mkdir: (root: string, rel: string) => ipcRenderer.invoke('explorer:mkdir', root, rel),
    createFile: (root: string, rel: string) => ipcRenderer.invoke('explorer:createFile', root, rel),
    rename: (root: string, rel: string, newName: string) =>
      ipcRenderer.invoke('explorer:rename', root, rel, newName),
    delete: (root: string, rel: string) => ipcRenderer.invoke('explorer:delete', root, rel),
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
