import { useRef } from 'react'
import { TOOLBOX_MODULE_MAP } from './registry'
import { SaveToVaultButton } from './SaveToVaultButton'
import { TOOLBOX_MODULES } from '../../shared/constants'

interface ModuleContentProps {
  module: string
}

export function ModuleContent({ module }: ModuleContentProps) {
  const ModuleComponent = TOOLBOX_MODULE_MAP[module]
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
