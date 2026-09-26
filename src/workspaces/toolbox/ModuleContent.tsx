import { useRef } from 'react'
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
import { SaveToVaultButton } from './SaveToVaultButton'
import { TOOLBOX_MODULES } from '../../shared/constants'

interface ModuleContentProps {
  module: string
}

const moduleMap: Record<string, React.ComponentType> = {
  json: JsonTool,
  url: UrlTool,
  base64: Base64Tool,
  codec: CodecTool,
  crypto: CryptoTool,
  regex: RegexTool,
  timestamp: TimestampTool,
  baseconverter: BaseConverterTool,
  qrcode: QrCodeTool,
  difftool: DiffTool,
  password: PasswordGeneratorTool,
  websocket: WebSocketTool,
  mockserver: MockServerTool,
  http: HttpModule,
  ssh: SSHModule,
  ip: IpTool,
  database: DatabaseTool,
  textprocess: TextProcessTool,
  formatconverter: FormatConverterTool,
  filehash: FileHashTool,
  calculator: ProgrammerCalculatorTool,
  logviewer: LogViewerTool,
  mirror: MirrorTool,
  imagetool: ImageTool,
  snippets: SnippetsModule,
  notes: NotesModule,
  system: SystemModule,
}

export function ModuleContent({ module }: ModuleContentProps) {
  const ModuleComponent = moduleMap[module]
  const containerRef = useRef<HTMLDivElement>(null)

  if (ModuleComponent) {
    const mod = TOOLBOX_MODULES.find((m) => m.id === module)
    return (
      <div className="module-content" ref={containerRef}>
        <ModuleComponent />
        <SaveToVaultButton moduleName={mod?.name ?? module} containerRef={containerRef} />
      </div>
    )
  }

  const mod = TOOLBOX_MODULES.find((m) => m.id === module)
  return (
    <div className="module-content">
      <div className="module-pending">
        <span className="module-pending-icon">{mod?.icon ?? '🧰'}</span>
        <h3>{mod?.name ?? module}</h3>
        <p>该工具将在 Phase 4 迁移</p>
      </div>
    </div>
  )
}
