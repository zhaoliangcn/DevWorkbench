import { TOOLBOX_MODULES } from '../../shared/constants'
import { useToolboxStore } from '../../store/toolboxStore'

const CATEGORIES = [
  { key: 'devtools', title: '开发工具' },
  { key: 'network', title: '网络 & 调试' },
  { key: 'file', title: '文件处理' },
  { key: 'system', title: '系统工具' },
] as const

export function Sidebar() {
  const activeModule = useToolboxStore((s) => s.activeModule)
  const setActiveModule = useToolboxStore((s) => s.setActiveModule)

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <h2>工具箱</h2>
      </div>
      <nav className="sidebar-nav">
        {CATEGORIES.map((cat) => {
          const mods = TOOLBOX_MODULES.filter((m) => m.category === cat.key)
          if (mods.length === 0) return null
          return (
            <div className="nav-section" key={cat.key}>
              <div className="nav-section-title">{cat.title}</div>
              {mods.map((mod) => (
                <button
                  key={mod.id}
                  className={`nav-item ${activeModule === mod.id ? 'active' : ''}`}
                  onClick={() => setActiveModule(mod.id)}
                >
                  <span className="nav-icon">{mod.icon}</span>
                  <span className="nav-label">{mod.name}</span>
                </button>
              ))}
            </div>
          )
        })}
      </nav>
    </div>
  )
}
