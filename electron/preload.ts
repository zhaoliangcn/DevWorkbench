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
  },
  file: {
    read: (relativePath: string) => ipcRenderer.invoke('file:read', relativePath),
    write: (relativePath: string, content: string) => ipcRenderer.invoke('file:write', relativePath, content),
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
      port?: number
    }) => ipcRenderer.invoke('assistant:start', options),
    stop: () => ipcRenderer.invoke('assistant:stop'),
    status: () => ipcRenderer.invoke('assistant:status'),
    run: (message: string) => ipcRenderer.invoke('assistant:run', message),
    setModels: (models: unknown[]) => ipcRenderer.invoke('assistant:setModels', models),
    switchModel: (name: string) => ipcRenderer.invoke('assistant:switchModel', name),
    providers: () => ipcRenderer.invoke('assistant:providers'),
    onEvent: (callback: (e: unknown) => void) => {
      const listener = (_event: unknown, e: unknown) => callback(e)
      ipcRenderer.on('assistant:events', listener)
      return () => ipcRenderer.removeListener('assistant:events', listener)
    },
  },
}

contextBridge.exposeInMainWorld('electronAPI', api)

export type ElectronAPI = typeof api
