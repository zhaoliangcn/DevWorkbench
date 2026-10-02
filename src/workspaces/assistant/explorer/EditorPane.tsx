import { Lock, LockOpen, Save } from 'lucide-react'
import { useExplorerStore } from '../../../store/explorerStore'
import { EditorTabs } from './EditorTabs'
import { FileEditor } from './FileEditor'
import { FilePreview } from './FilePreview'
import { formatSize } from './fileKind'

// 编辑器区：标签栏 + 文件工具条（路径/只读锁/保存）+ monaco 编辑器或预览。

export function EditorPane() {
  const tabs = useExplorerStore((s) => s.tabs)
  const activeTabId = useExplorerStore((s) => s.activeTabId)
  const toggleLocked = useExplorerStore((s) => s.toggleLocked)
  const saveTab = useExplorerStore((s) => s.saveTab)

  const active = tabs.find((t) => t.id === activeTabId) ?? null

  if (!active) {
    return (
      <div className="editor-pane editor-pane-empty">
        <EditorTabs />
        <div className="editor-empty-hint">在左侧目录树中点击文件以打开</div>
      </div>
    )
  }

  const canSave = active.kind === 'text'

  return (
    <div className="editor-pane">
      <EditorTabs />
      <div className="editor-filebar">
        <span className="editor-filebar-path" title={active.id}>
          {active.id}
          {active.dirty && <span className="editor-filebar-dirty">（未保存）</span>}
        </span>
        <span className="editor-filebar-meta">
          {formatSize(active.size)} · {new Date(active.mtime).toLocaleString()}
        </span>
        {canSave && (
          <>
            <button
              className="explorer-tool-btn"
              title={active.locked ? '解除只读' : '锁定为只读'}
              onClick={() => toggleLocked(active.id)}
            >
              {active.locked ? <Lock size={14} /> : <LockOpen size={14} />}
            </button>
            <button
              className="explorer-tool-btn"
              title="保存（Ctrl+S）"
              disabled={!active.dirty}
              onClick={() => {
                void saveTab(active.id).then((r) => {
                  if (!r.success) window.alert(`保存失败：${r.error}`)
                })
              }}
            >
              <Save size={14} />
            </button>
          </>
        )}
      </div>
      <div className="editor-content">
        {active.kind === 'text' ? <FileEditor tabId={active.id} /> : <FilePreview tabId={active.id} />}
      </div>
    </div>
  )
}
