import { Sidebar } from './Sidebar'
import { ModuleContent } from './ModuleContent'
import { useToolboxStore } from '../../store/toolboxStore'
import './toolbox.css'

export function ToolboxWorkspace() {
  const activeModule = useToolboxStore((s) => s.activeModule)

  return (
    <div className="tb-root">
      <div className="tb-layout">
        <Sidebar />
        <ModuleContent module={activeModule} />
      </div>
    </div>
  )
}
