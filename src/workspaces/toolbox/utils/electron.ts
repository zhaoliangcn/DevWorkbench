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
}

// 默认 mock 实现，用于纯 Web 环境
const mockAPI: ElectronAPIAdapter = {
  getAppVersion: () => Promise.resolve('1.0.0'),
  checkEnv: () => Promise.resolve({ name: 'unknown', installed: false }),
  checkPort: () => Promise.resolve(null),
  scanPort: () => Promise.resolve(false),
  getLocalIps: () => Promise.resolve([]),
  killProcess: () => Promise.resolve(false),
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
  }
}

export const electronAPI = createElectronAPI()
