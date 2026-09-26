import { useEffect } from 'react'
import { useStore } from '../../store/knowledgeStore'
import Sidebar from './components/Sidebar'
import RightPanel from './components/RightPanel'
import MarkdownEditor from './components/MarkdownEditor'
import { CarryLanding } from './components/CarryLanding'
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react'
import { tryRestoreVault } from './utils/filesystem'
import { useAppStore } from '../../store/appStore'
import './knowledge.css'

// 知识库工作区：沿用 my-obsidian 的三栏布局（文件树 / 编辑器 / 右侧面板）
export function KnowledgeWorkspace() {
  const sidebarVisible = useStore((s) => s.sidebarVisible)
  const rightPanelVisible = useStore((s) => s.rightPanelVisible)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const toggleRightPanel = useStore((s) => s.toggleRightPanel)
  // 主题以全局 appStore 为单一数据源
  const theme = useAppStore((s) => s.theme)
  const loadVaultFromDisk = useStore((s) => s.loadVaultFromDisk)

  useEffect(() => {
    tryRestoreVault().then((result) => {
      if (result) {
        useStore.setState({ vaultName: result.name, vaultReady: true })
        loadVaultFromDisk()
      } else {
        useStore.setState({ vaultReady: true })
      }
    })
  }, [loadVaultFromDisk])

  return (
    <div className={`kb-root app ${theme}`}>
      <div className="app-layout">
        {sidebarVisible && (
          <div className="sidebar-container">
            <Sidebar />
          </div>
        )}

        <div className="main-container">
          <div className="main-header">
            <button
              className="icon-btn toggle-btn"
              onClick={toggleSidebar}
              title={sidebarVisible ? '关闭侧边栏' : '打开侧边栏'}
            >
              {sidebarVisible ? (
                <PanelLeftClose size={18} />
              ) : (
                <PanelLeftOpen size={18} />
              )}
            </button>
            <div className="main-header-spacer" />
            <button
              className="icon-btn toggle-btn"
              onClick={toggleRightPanel}
              title={rightPanelVisible ? '关闭右侧面板' : '打开右侧面板'}
            >
              {rightPanelVisible ? (
                <PanelRightClose size={18} />
              ) : (
                <PanelRightOpen size={18} />
              )}
            </button>
          </div>
          <MarkdownEditor />
        </div>

        {rightPanelVisible && <RightPanel />}
      </div>

      {/* 跨工作区联动：工具箱/AI 助手等来源的携带物落地确认浮层（切片 A） */}
      <CarryLanding />
    </div>
  )
}
