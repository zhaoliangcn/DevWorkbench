// 工具箱工作区类型（来自 dev-tool-box）

export interface SSHConfig {
  id: string
  name: string
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
  group?: string
  createdAt?: number
  updatedAt?: number
  lastConnected?: number
}

export interface CodeSnippet {
  id: string
  title: string
  content: string
  language: string
  category: string
  tags: string[]
  createdAt: number
  updatedAt: number
  usageCount?: number
}

export interface HttpRequest {
  id: string
  name?: string
  method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH'
  url: string
  headers: Record<string, string>
  body?: string
  response?: string
  statusCode?: number
  duration?: number
  createdAt: number
  updatedAt?: number
}

export interface EnvInfo {
  name: string
  installed: boolean
  version?: string
  path?: string
}

export interface PortInfo {
  port: number
  protocol: 'TCP' | 'UDP'
  pid?: number
  processName?: string
  state?: string
}

export interface ServerGroup {
  id: string
  name: string
  servers: SSHConfig[]
}

export interface SnippetCategory {
  id: string
  name: string
  snippets: CodeSnippet[]
}

export interface RequestCollection {
  id: string
  name: string
  requests: HttpRequest[]
}

export interface SavedCommand {
  id: string
  name: string
  command: string
  description: string
  createdAt: number
  usageCount: number
}
