import FileExplorer from './FileExplorer'
import SettingsPanel from './SettingsPanel'
import { useStore } from '../../../store/knowledgeStore'
import { BookOpen, Moon, Sun, Settings } from 'lucide-react'
import { useState } from 'react'

export default function Sidebar() {
  const theme = useStore((s) => s.theme)
  const setTheme = useStore((s) => s.setTheme)
  const vaultName = useStore((s) => s.vaultName)
  const [showSettings, setShowSettings] = useState(false)

  if (showSettings) {
    return (
      <div className="sidebar">
        <div className="sidebar-header">
          <div className="vault-title">
            <Settings size={18} />
            <span>设置</span>
          </div>
          <button
            className="icon-btn"
            onClick={() => setShowSettings(false)}
            title="返回"
          >
            <BookOpen size={16} />
          </button>
        </div>
        <SettingsPanel />
      </div>
    )
  }

  return (
    <div className="sidebar">
      <div className="sidebar-header">
        <div className="vault-title">
          <BookOpen size={18} />
          <span>{vaultName || 'MyObsidian'}</span>
        </div>
        <div className="sidebar-header-actions">
          <button
            className="icon-btn"
            onClick={() => setShowSettings(true)}
            title="设置"
          >
            <Settings size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title="切换主题"
          >
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>
      </div>
      <FileExplorer />
    </div>
  )
}
