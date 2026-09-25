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
}

interface AssistantStatus {
  running: boolean
  port: number | null
  url: string | null
  sessionId: string | null
  providerNames: string[]
  activeProvider: string | null
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
