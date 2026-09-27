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

export interface ApiEnvironment {
  id: string
  name: string
  /** 变量字典：{{host}} / {{env.key}} 插值来源 */
  variables: Record<string, string>
  /** 单激活（同一时刻仅一个环境 active=true） */
  active: boolean
}

export interface ApiAssertion {
  id: string
  type: 'status' | 'header' | 'bodyContains' | 'jsonPath' | 'timeMs'
  op: 'eq' | 'gt' | 'lt' | 'contains' | 'matches'
  /** status 为数字字符串；header 为 key=value；bodyContains 为文本；jsonPath 为 $.a.b 路径；timeMs 为数字上限 */
  expected: string | number
  /** jsonPath 断言的期望值（expected 存路径，值存这里） */
  expectedValue?: string | number
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
  /** 附录 F F.1：归属集合 */
  collectionId?: string
  /** 附录 F F.1：创建时绑定环境（发送时插值来源） */
  environmentId?: string
  /** 附录 F F.1：断言列表（响应后逐条校验） */
  assertions: ApiAssertion[]
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
