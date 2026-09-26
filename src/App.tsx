import { useEffect } from 'react'
import { BookOpen, Wrench, Settings, Moon, Sun, Bot } from 'lucide-react'
import { useAppStore, type Workspace } from './store/appStore'
import { KnowledgeWorkspace } from './workspaces/knowledge/KnowledgeWorkspace'
import { AssistantWorkspace } from './workspaces/assistant/AssistantWorkspace'
import { ToolboxWorkspace } from './workspaces/toolbox/ToolboxWorkspace'
import { SettingsWorkspace } from './workspaces/settings/SettingsWorkspace'
import { CapturePalette } from './shared/components/CapturePalette'
import { CarryIndicator } from './shared/components/CarryIndicator'

const NAV_ITEMS: Array<{ key: Workspace; label: string; icon: React.ComponentType<{ size?: number }> }> = [
  { key: 'knowledge', label: '知识库', icon: BookOpen },
  { key: 'assistant', label: 'AI 助手', icon: Bot },
  { key: 'toolbox', label: '开发工具', icon: Wrench },
  { key: 'settings', label: '设置', icon: Settings },
]

export default function App() {
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  return (
    <div className="app-shell">
      <header className="top-nav">
        <div className="top-nav-brand">
          <span className="brand-mark">DW</span>
          <span className="brand-name">DevWorkbench</span>
        </div>
        <nav className="top-nav-tabs" role="tablist" aria-label="工作区切换">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const active = activeWorkspace === item.key
            return (
              <button
                key={item.key}
                role="tab"
                aria-selected={active}
                className={`nav-tab${active ? ' active' : ''}`}
                onClick={() => setActiveWorkspace(item.key)}
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
        <div className="top-nav-actions">
          <button
            className="top-icon-btn"
            onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
            aria-label="切换主题"
            title="切换主题"
          >
            {theme === 'light' ? <Moon size={16} /> : <Sun size={16} />}
          </button>
        </div>
      </header>

      <main className="workspace-body">
        {activeWorkspace === 'knowledge' && <KnowledgeWorkspace />}
        {activeWorkspace === 'assistant' && <AssistantWorkspace />}
        {activeWorkspace === 'toolbox' && <ToolboxWorkspace />}
        {activeWorkspace === 'settings' && <SettingsWorkspace />}
      </main>

      {/* 跨工作区联动：全局捕获中心 + 携带物徽章（切片 C） */}
      <CapturePalette />
      <CarryIndicator />
    </div>
  )
}
