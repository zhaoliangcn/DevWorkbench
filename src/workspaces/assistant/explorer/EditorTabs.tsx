import { X } from 'lucide-react'
import { useExplorerStore } from '../../../store/explorerStore'
import { extOf, isImageExt } from './fileKind'

// 打开文件标签栏：脏点标记、点击切换、关闭按钮。

export function EditorTabs() {
  const tabs = useExplorerStore((s) => s.tabs)
  const activeTabId = useExplorerStore((s) => s.activeTabId)
  const setActiveTab = useExplorerStore((s) => s.setActiveTab)
  const closeTab = useExplorerStore((s) => s.closeTab)

  if (tabs.length === 0) return null

  return (
    <div className="editor-tabs">
      {tabs.map((t) => (
        <div
          key={t.id}
          className={`editor-tab ${t.id === activeTabId ? 'active' : ''}`}
          onClick={() => setActiveTab(t.id)}
          title={t.id}
        >
          {t.kind === 'image' || isImageExt(extOf(t.id)) ? '🖼' : '📄'} {t.id.split('/').pop()}
          {t.dirty && <span className="editor-tab-dirty" title="未保存" />}
          <button
            className="editor-tab-close"
            title="关闭"
            onClick={(e) => {
              e.stopPropagation()
              closeTab(t.id)
            }}
          >
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  )
}
