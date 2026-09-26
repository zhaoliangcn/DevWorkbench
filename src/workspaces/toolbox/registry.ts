import type { ComponentType } from 'react'
import { JsonTool } from './tools/JsonTool'
import { UrlTool } from './tools/UrlTool'
import { Base64Tool } from './tools/Base64Tool'
import { CodecTool } from './tools/CodecTool'
import { CryptoTool } from './tools/CryptoTool'
import { RegexTool } from './tools/RegexTool'
import { TimestampTool } from './tools/TimestampTool'
import { BaseConverterTool } from './tools/BaseConverterTool'
import { QrCodeTool } from './tools/QrCodeTool'
import { DiffTool } from './tools/DiffTool'
import { PasswordGeneratorTool } from './tools/PasswordGeneratorTool'
import { WebSocketTool } from './tools/WebSocketTool'
import { MockServerTool } from './tools/MockServerTool'
import { HttpModule } from './tools/HttpModule'
import { SSHModule } from './tools/SSHModule'
import { IpTool } from './tools/IpTool'
import { DatabaseTool } from './tools/DatabaseTool'
import { TextProcessTool } from './tools/TextProcessTool'
import { FormatConverterTool } from './tools/FormatConverterTool'
import { FileHashTool } from './tools/FileHashTool'
import { ProgrammerCalculatorTool } from './tools/ProgrammerCalculatorTool'
import { LogViewerTool } from './tools/LogViewerTool'
import { MirrorTool } from './tools/MirrorTool'
import { ImageTool } from './tools/ImageTool'
import { SnippetsModule } from './tools/SnippetsModule'
import { NotesModule } from './tools/NotesModule'
import { SystemModule } from './tools/SystemModule'

/** 工具箱模块定义（设计附录 D P0）：由硬编码 moduleMap 收敛为注册表单一事实源 */
export interface ToolboxModuleDef {
  /** 与 shared/constants 的 TOOLBOX_MODULES[].id 对应 */
  id: string
  component: ComponentType
}

/** 收口模块定义；新增已迁移模块只需在 TOOLBOX_MODULE_REGISTRY 里加一条记录 */
function defineToolboxModule(id: string, component: ComponentType): ToolboxModuleDef {
  return { id, component }
}

export const TOOLBOX_MODULE_REGISTRY: ToolboxModuleDef[] = [
  defineToolboxModule('json', JsonTool),
  defineToolboxModule('url', UrlTool),
  defineToolboxModule('base64', Base64Tool),
  defineToolboxModule('codec', CodecTool),
  defineToolboxModule('crypto', CryptoTool),
  defineToolboxModule('regex', RegexTool),
  defineToolboxModule('timestamp', TimestampTool),
  defineToolboxModule('baseconverter', BaseConverterTool),
  defineToolboxModule('qrcode', QrCodeTool),
  defineToolboxModule('difftool', DiffTool),
  defineToolboxModule('password', PasswordGeneratorTool),
  defineToolboxModule('websocket', WebSocketTool),
  defineToolboxModule('mockserver', MockServerTool),
  defineToolboxModule('http', HttpModule),
  defineToolboxModule('ssh', SSHModule),
  defineToolboxModule('ip', IpTool),
  defineToolboxModule('database', DatabaseTool),
  defineToolboxModule('textprocess', TextProcessTool),
  defineToolboxModule('formatconverter', FormatConverterTool),
  defineToolboxModule('filehash', FileHashTool),
  defineToolboxModule('calculator', ProgrammerCalculatorTool),
  defineToolboxModule('logviewer', LogViewerTool),
  defineToolboxModule('mirror', MirrorTool),
  defineToolboxModule('imagetool', ImageTool),
  defineToolboxModule('snippets', SnippetsModule),
  defineToolboxModule('notes', NotesModule),
  defineToolboxModule('system', SystemModule),
]

/** id → 组件映射，由注册表派生（取用方式与旧 moduleMap 等价，便于静态分析） */
export const TOOLBOX_MODULE_MAP: Record<string, ComponentType> = Object.fromEntries(
  TOOLBOX_MODULE_REGISTRY.map((d) => [d.id, d.component]),
)
