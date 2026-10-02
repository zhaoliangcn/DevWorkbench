// 工具箱 IPC 适配层：保持 dev-tool-box 原有的扁平 API 形状，
// 内部转发到 devworkbench 新的命名空间通道（window.electronAPI）。

export interface SSHConnectConfig {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
}

export interface SSHExecResult {
  success: boolean
  stdout?: string
  stderr?: string
  code?: number
  error?: string
}

/** 附录 F F.4b：Cron 任务与日志（与 ElectronAPI.cron 命名空间同构） */
export interface CronTaskDef {
  id: string
  name: string
  expr: string
  target:
    | { type: 'http'; url: string; method?: string; headers?: Record<string, string>; body?: string }
    | { type: 'script'; command: string }
    | { type: 'agent'; prompt: string }
  enabled: boolean
  lastRunAt?: number
}

export interface CronLogEntryDef {
  id: string
  taskId: string
  taskName: string
  target: string
  ok: boolean
  detail: string
  at: number
}

export interface ElectronAPIAdapter {
  getAppVersion: () => Promise<string>
  checkEnv: (envType: string) => Promise<{ name: string; installed: boolean; version?: string }>
  checkPort: (port: number) => Promise<{
    port: number
    protocol: string
    pid?: number
    processName?: string
    state?: string
  } | null>
  scanPort: (host: string, port: number) => Promise<boolean>
  getLocalIps: () => Promise<string[]>
  killProcess: (pid: number) => Promise<boolean>
  /** 附录 B.6.2：进程监视器 */
  listProcesses: () => Promise<{ success: boolean; raw: string; kind: string; error?: string }>
  saveData: (key: string, data: unknown) => Promise<boolean>
  loadData: (key: string) => Promise<unknown>
  deleteData: (key: string) => Promise<boolean>
  getPlatform: () => Promise<{ platform: string; arch: string; homedir: string }>
  checkMirror: (url: string) => Promise<{
    url: string
    available: boolean
    statusCode: number | null
    error?: string
    responseTime: number
  }>

  // SSH
  sshConnect: (connectionId: string, config: SSHConnectConfig) => Promise<{ success: boolean; error?: string }>
  sshDisconnect: (connectionId: string) => Promise<{ success: boolean; error?: string }>
  sshExec: (connectionId: string, command: string) => Promise<SSHExecResult>
  sshOpenShell: (connectionId: string, cols: number, rows: number) => Promise<{ success: boolean }>
  sshShellWrite: (connectionId: string, data: string) => Promise<{ success: boolean; error?: string }>
  sshShellResize: (connectionId: string, cols: number, rows: number) => Promise<{ success: boolean }>
  onShellData: (connectionId: string, callback: (data: string) => void) => void
  onShellError: (connectionId: string, callback: (error: string) => void) => void
  onShellClose: (connectionId: string, callback: () => void) => void

  /** 附录 F F.2：HTTP 请求经主进程发出（绕 CORS），二进制响应 base64 回传 */
  httpRequest: (args: {
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
    body: string
    bodyIsBase64: boolean
    durationMs: number
    error?: string
  }>

  /** 附录 F F.3：Webhook 接收器 */
  webhookList: () => Promise<{
    listening: boolean
    port: number | null
    enabled: boolean
    events: { id: string; method: string; path: string; headers: Record<string, string>; body: string; receivedAt: number }[]
  }>
  webhookSetEnabled: (enabled: boolean) => Promise<{
    listening: boolean
    port: number | null
    enabled: boolean
    error?: string
  }>
  webhookClear: () => Promise<boolean>
  onWebhookReceived: (
    callback: (ev: { id: string; method: string; path: string; headers: Record<string, string>; body: string; receivedAt: number }) => void,
  ) => () => void

  /** 附录 F F.4b：Cron 触发调度器 */
  cronGetTasks: () => Promise<{ tasks: CronTaskDef[]; logs: CronLogEntryDef[] }>
  cronSetTasks: (tasks: CronTaskDef[]) => Promise<{ success: boolean; error?: string }>
  cronTrigger: (taskId: string) => Promise<{ success: boolean; error?: string }>
  cronClearLogs: () => Promise<boolean>
  onCronLog: (callback: (entry: CronLogEntryDef) => void) => () => void

  /** 附录 F F.5：Redis 客户端 */
  redisConnect: (args: { id: string; host: string; port: number; password?: string; db?: number }) => Promise<{
    success: boolean
    version?: string
    error?: string
  }>
  redisExec: (id: string, command: string) => Promise<{
    success: boolean
    value?: unknown
    elapsedMs?: number
    error?: string
  }>
  redisScan: (id: string, cursor: string, match: string, count: number) => Promise<{
    success: boolean
    cursor?: string
    keys?: string[]
    error?: string
  }>
  redisDisconnect: (id: string) => Promise<{ success: boolean }>

  /** 附录 F F.6：SQLite 浏览器 */
  sqliteCheck: () => Promise<{ available: boolean; error?: string }>
  sqliteOpen: () => Promise<{ success: boolean; canceled?: boolean; filePath?: string; name?: string; error?: string }>
  sqliteTables: () => Promise<{ success: boolean; tables?: { name: string; type: string }[]; error?: string }>
  sqliteColumns: (table: string) => Promise<{ success: boolean; columns?: { name: string; type: string; pk: boolean }[]; error?: string }>
  sqliteRows: (table: string, where: string, page: number) => Promise<{
    success: boolean
    rows?: Record<string, unknown>[]
    columns?: string[]
    total?: number
    page?: number
    pageSize?: number
    error?: string
  }>
  sqliteExec: (sql: string) => Promise<{
    success: boolean
    rows?: Record<string, unknown>[]
    columns?: string[]
    changes?: number
    error?: string
  }>
  sqliteClose: () => Promise<{ success: boolean }>

  /** 附录 B.6.1：Docker 管理面板 */
  dockerCheck: () => Promise<{ available: boolean; version?: string; error?: string }>
  dockerContainers: () => Promise<{ success: boolean; raw: string; error?: string }>
  dockerImages: () => Promise<{ success: boolean; raw: string; error?: string }>
  dockerLogs: (id: string, tail?: number) => Promise<{ success: boolean; logs: string; error?: string }>
  dockerAction: (action: string, id: string) => Promise<{ success: boolean; error?: string }>

  /** 附录 B.6.3：.env 管理器 */
  envPickFiles: () => Promise<{
    success: boolean
    canceled: boolean
    files: { path: string; name: string }[]
  }>
  envReadFile: (filePath: string) => Promise<{ success: boolean; raw: string; error?: string }>

  /** SMB 共享管理（smb:* 命名空间） */
  smbCheck: () => Promise<{ available: boolean; platform: string; isAdmin?: boolean; error?: string }>
  smbList: () => Promise<{ success: boolean; raw: string; platform: string; error?: string }>
  smbCreate: (args: { name: string; path: string; remark?: string; readonly?: boolean; users?: string }) =>
    Promise<{ success: boolean; error?: string }>
  smbDelete: (name: string) => Promise<{ success: boolean; error?: string }>
  smbPickDir: () => Promise<{ success: boolean; canceled: boolean; path: string }>

  /** 附录 B.7：凭据保险库（主密码仅存渲染层内存，主进程不持久化） */
  vaultStatus: () => Promise<{ initialized: boolean; entryCount: number }>
  vaultInit: (password: string) => Promise<{ success: boolean; error?: string }>
  vaultVerify: (password: string) => Promise<{ success: boolean; verified: boolean; error?: string }>
  vaultList: (password: string) => Promise<{
    success: boolean
    entries: { id: string; name: string; kind: string; createdAt: string }[]
    error?: string
  }>
  vaultGet: (password: string, id: string) => Promise<{
    success: boolean
    value: string
    error?: string
  }>
  vaultPut: (
    password: string,
    payload: { id?: string; name: string; kind: string; value: string }
  ) => Promise<{ success: boolean; error?: string }>
  vaultDelete: (password: string, id: string) => Promise<{ success: boolean; error?: string }>
}

// 默认 mock 实现，用于纯 Web 环境
const mockAPI: ElectronAPIAdapter = {
  getAppVersion: () => Promise.resolve('1.0.0'),
  checkEnv: () => Promise.resolve({ name: 'unknown', installed: false }),
  checkPort: () => Promise.resolve(null),
  scanPort: () => Promise.resolve(false),
  getLocalIps: () => Promise.resolve([]),
  killProcess: () => Promise.resolve(false),
  listProcesses: () => Promise.resolve({ success: false, raw: '', kind: '', error: 'Web 环境不支持进程监视' }),
  saveData: () => Promise.resolve(true),
  loadData: () => Promise.resolve(null),
  deleteData: () => Promise.resolve(true),
  getPlatform: () =>
    Promise.resolve({
      platform: 'browser',
      arch: 'unknown',
      homedir: '/',
    }),
  checkMirror: () =>
    Promise.resolve({
      url: '',
      available: false,
      statusCode: null,
      error: 'Web 环境不支持镜像验证',
      responseTime: Date.now(),
    }),

  sshConnect: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SSH' }),
  sshDisconnect: () => Promise.resolve({ success: true }),
  sshExec: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SSH' }),
  sshOpenShell: () => Promise.resolve({ success: false }),
  sshShellWrite: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SSH' }),
  sshShellResize: () => Promise.resolve({ success: false }),
  onShellData: () => {},
  onShellError: () => {},
  onShellClose: () => {},

  // Web 环境：直接用 fetch（同源/无 CORS 场景），保持接口一致
  httpRequest: async (args) => {
    const startTime = Date.now()
    try {
      const res = await fetch(args.url, {
        method: args.method ?? 'GET',
        headers: args.headers,
        body: ['POST', 'PUT', 'PATCH'].includes((args.method ?? 'GET').toUpperCase()) ? args.body : undefined,
      })
      const resHeaders: Record<string, string> = {}
      res.headers.forEach((value, key) => {
        resHeaders[key.toLowerCase()] = value
      })
      return {
        success: true,
        status: res.status,
        statusText: res.statusText,
        headers: resHeaders,
        body: await res.text(),
        bodyIsBase64: false,
        durationMs: Date.now() - startTime,
      }
    } catch (e) {
      return {
        success: false,
        status: null,
        statusText: '',
        headers: {},
        body: '',
        bodyIsBase64: false,
        durationMs: Date.now() - startTime,
        error: (e as Error).message,
      }
    }
  },

  webhookList: () =>
    Promise.resolve({ listening: false, port: null, enabled: false, events: [] }),
  webhookSetEnabled: () =>
    Promise.resolve({ listening: false, port: null, enabled: false, error: 'Web 环境不支持 Webhook 接收' }),
  webhookClear: () => Promise.resolve(true),
  onWebhookReceived: () => () => {},

  cronGetTasks: () => Promise.resolve({ tasks: [], logs: [] }),
  cronSetTasks: () => Promise.resolve({ success: false, error: 'Web 环境不支持 Cron 触发' }),
  cronTrigger: () => Promise.resolve({ success: false, error: 'Web 环境不支持 Cron 触发' }),
  cronClearLogs: () => Promise.resolve(true),
  onCronLog: () => () => {},

  redisConnect: () => Promise.resolve({ success: false, error: 'Web 环境不支持 Redis' }),
  redisExec: () => Promise.resolve({ success: false, error: 'Web 环境不支持 Redis' }),
  redisScan: () => Promise.resolve({ success: false, error: 'Web 环境不支持 Redis' }),
  redisDisconnect: () => Promise.resolve({ success: true }),

  sqliteCheck: () => Promise.resolve({ available: false, error: 'Web 环境不支持 SQLite' }),
  sqliteOpen: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SQLite' }),
  sqliteTables: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SQLite' }),
  sqliteColumns: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SQLite' }),
  sqliteRows: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SQLite' }),
  sqliteExec: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SQLite' }),
  sqliteClose: () => Promise.resolve({ success: true }),

  dockerCheck: () => Promise.resolve({ available: false, error: 'Web 环境不支持 Docker' }),
  dockerContainers: () => Promise.resolve({ success: false, raw: '', error: 'Web 环境不支持 Docker' }),
  dockerImages: () => Promise.resolve({ success: false, raw: '', error: 'Web 环境不支持 Docker' }),
  dockerLogs: () => Promise.resolve({ success: false, logs: '', error: 'Web 环境不支持 Docker' }),
  dockerAction: () => Promise.resolve({ success: false, error: 'Web 环境不支持 Docker' }),

  envPickFiles: () => Promise.resolve({ success: false, canceled: true, files: [] }),
  envReadFile: () => Promise.resolve({ success: false, raw: '', error: 'Web 环境不支持文件读取' }),

  smbCheck: () => Promise.resolve({ available: false, platform: 'browser', error: 'Web 环境不支持 SMB 管理' }),
  smbList: () => Promise.resolve({ success: false, raw: '', platform: 'browser', error: 'Web 环境不支持 SMB 管理' }),
  smbCreate: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SMB 管理' }),
  smbDelete: () => Promise.resolve({ success: false, error: 'Web 环境不支持 SMB 管理' }),
  smbPickDir: () => Promise.resolve({ success: false, canceled: true, path: '' }),

  vaultStatus: () => Promise.resolve({ initialized: false, entryCount: 0 }),
  vaultInit: () => Promise.resolve({ success: false, error: 'Web 环境不支持保险库' }),
  vaultVerify: () => Promise.resolve({ success: false, verified: false, error: 'Web 环境不支持保险库' }),
  vaultList: () => Promise.resolve({ success: false, entries: [], error: 'Web 环境不支持保险库' }),
  vaultGet: () => Promise.resolve({ success: false, value: '', error: 'Web 环境不支持保险库' }),
  vaultPut: () => Promise.resolve({ success: false, error: 'Web 环境不支持保险库' }),
  vaultDelete: () => Promise.resolve({ success: false, error: 'Web 环境不支持保险库' }),
}

function createElectronAPI(): ElectronAPIAdapter {
  const bridge = window.electronAPI
  if (!bridge) return mockAPI

  return {
    getAppVersion: () => bridge.app.getVersion(),
    checkEnv: (envType) => bridge.system.checkEnv(envType),
    checkPort: (port) => bridge.system.checkPort(port),
    scanPort: (host, port) => bridge.system.checkPort(port, host),
    getLocalIps: () => bridge.system.getLocalIps(),
    killProcess: (pid) => bridge.system.killProcess(pid),
    listProcesses: () => bridge.system.listProcesses(),
    saveData: (key, data) => bridge.data.save(key, data),
    loadData: (key) => bridge.data.load(key),
    deleteData: (key) => bridge.data.delete(key),
    getPlatform: () => bridge.app.getPlatform(),
    checkMirror: (url) => bridge.system.checkMirror(url),

    sshConnect: (connectionId, config) => bridge.ssh.connect(connectionId, config),
    sshDisconnect: (connectionId) => bridge.ssh.disconnect(connectionId),
    sshExec: (connectionId, command) => bridge.ssh.exec(connectionId, command),
    sshOpenShell: (connectionId, cols, rows) => bridge.ssh.openShell(connectionId, cols, rows),
    sshShellWrite: (connectionId, data) => bridge.ssh.shellWrite(connectionId, data),
    sshShellResize: (connectionId, cols, rows) => bridge.ssh.shellResize(connectionId, cols, rows),
    onShellData: (connectionId, callback) => bridge.ssh.onShellData(connectionId, callback),
    onShellError: (connectionId, callback) => bridge.ssh.onShellError(connectionId, callback),
    onShellClose: (connectionId, callback) => bridge.ssh.onShellClose(connectionId, callback),

    httpRequest: (args) => bridge.http.request(args),

    webhookList: () => bridge.webhook.list(),
    webhookSetEnabled: (enabled) => bridge.webhook.setEnabled(enabled),
    webhookClear: () => bridge.webhook.clear(),
    onWebhookReceived: (callback) => bridge.webhook.onReceived(callback),

    cronGetTasks: () => bridge.cron.getTasks(),
    cronSetTasks: (tasks) => bridge.cron.setTasks(tasks),
    cronTrigger: (taskId) => bridge.cron.trigger(taskId),
    cronClearLogs: () => bridge.cron.clearLogs(),
    onCronLog: (callback) => bridge.cron.onLog(callback),

    redisConnect: (args) => bridge.redis.connect(args),
    redisExec: (id, command) => bridge.redis.exec(id, command),
    redisScan: (id, cursor, match, count) => bridge.redis.scan(id, cursor, match, count),
    redisDisconnect: (id) => bridge.redis.disconnect(id),

    sqliteCheck: () => bridge.sqlite.check(),
    sqliteOpen: () => bridge.sqlite.open(),
    sqliteTables: () => bridge.sqlite.tables(),
    sqliteColumns: (table) => bridge.sqlite.columns(table),
    sqliteRows: (table, where, page) => bridge.sqlite.rows(table, where, page),
    sqliteExec: (sql) => bridge.sqlite.exec(sql),
    sqliteClose: () => bridge.sqlite.close(),

    dockerCheck: () => bridge.docker.check(),
    dockerContainers: () => bridge.docker.containers(),
    dockerImages: () => bridge.docker.images(),
    dockerLogs: (id, tail) => bridge.docker.logs(id, tail),
    dockerAction: (action, id) => bridge.docker.action(action, id),

    envPickFiles: () => bridge.envfile.pick(),
    envReadFile: (filePath) => bridge.envfile.read(filePath),

    smbCheck: () => bridge.smb.check(),
    smbList: () => bridge.smb.list(),
    smbCreate: (args) => bridge.smb.create(args),
    smbDelete: (name) => bridge.smb.delete(name),
    smbPickDir: () => bridge.smb.pickDir(),

    vaultStatus: () => bridge.secvault.status(),
    vaultInit: (password) => bridge.secvault.init(password),
    vaultVerify: (password) => bridge.secvault.verify(password),
    vaultList: (password) => bridge.secvault.list(password),
    vaultGet: (password, id) => bridge.secvault.get(password, id),
    vaultPut: (password, payload) => bridge.secvault.put(password, payload),
    vaultDelete: (password, id) => bridge.secvault.del(password, id),
  }
}

export const electronAPI = createElectronAPI()
