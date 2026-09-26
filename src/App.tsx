import { Activity, useCallback, useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'
import { useAppStore } from './store/appStore'
import { WORKSPACES } from './shared/workspaces'
import { useGlobalShortcuts } from './shared/hooks/useGlobalShortcuts'
import { ErrorBoundary } from './shared/components/ErrorBoundary'
import { DeferredWorkspace } from './shared/components/DeferredWorkspace'
import { CommandPalette } from './shared/components/CommandPalette'
import { CarryIndicator } from './shared/components/CarryIndicator'

/** 根级兜底降级 UI（附录 D P0）：整个外壳崩溃时的最后一道防线 */
function renderFatalFallback(error: Error, retry: () => void) {
  return (
    <div className="error-boundary error-boundary--fatal" role="alert">
      <h2>应用发生未捕获错误</h2>
      <p className="error-boundary-message">{error.message}</p>
      <div className="error-boundary-actions">
        <button className="error-boundary-btn" onClick={retry}>
          重试
        </button>
        <button className="error-boundary-btn" onClick={() => window.location.reload()}>
          重载窗口
        </button>
      </div>
    </div>
  )
}

export default function App() {
  const activeWorkspace = useAppStore((s) => s.activeWorkspace)
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace)
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // 命令面板开关（P2：CapturePalette → CommandPalette；快捷键统一收口在 useGlobalShortcuts）
  const [paletteOpen, setPaletteOpen] = useState(false)
  const togglePalette = useCallback(() => setPaletteOpen((v) => !v), [])
  const closePalette = useCallback(() => setPaletteOpen(false), [])
  useGlobalShortcuts({ onTogglePalette: togglePalette, onClosePalette: closePalette })

  return (
    <ErrorBoundary fallback={renderFatalFallback}>
      <div className="app-shell">
        <header className="top-nav">
          <div className="top-nav-brand">
            <span className="brand-mark">DW</span>
            <span className="brand-name">DevWorkbench</span>
          </div>
          <nav className="top-nav-tabs" role="tablist" aria-label="工作区切换">
            {WORKSPACES.map((item) => {
              const Icon = item.icon
              const isActive = activeWorkspace === item.key
              return (
                <button
                  key={item.key}
                  role="tab"
                  aria-selected={isActive}
                  className={`nav-tab${isActive ? ' active' : ''}`}
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
          {/* Activity 保活（附录 D P1）：四工作区常驻挂载 —— 隐藏区 state 保留
              （草稿/滚动/undo 不丢），effects 自动卸载（订阅暂停、不空转）。
              DeferredWorkspace（P2）在 Activity 内侧：hidden 不挂载子树，chunk
              仅在首次激活时加载，规避 D.5「首帧四 chunk 全触发」 */}
          {WORKSPACES.map((def) => (
            <ErrorBoundary key={def.key} title={def.label}>
              <Activity mode={activeWorkspace === def.key ? 'visible' : 'hidden'}>
                <DeferredWorkspace def={def} active={activeWorkspace === def.key} />
              </Activity>
            </ErrorBoundary>
          ))}
        </main>

        {/* 跨工作区联动：全局命令面板（含捕获分发）+ 携带物徽章（切片 C） */}
        <CommandPalette open={paletteOpen} onClose={closePalette} />
        <CarryIndicator />
      </div>
    </ErrorBoundary>
  )
}
