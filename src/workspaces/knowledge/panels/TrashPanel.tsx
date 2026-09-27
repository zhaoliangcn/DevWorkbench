import { useEffect, useState } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { listTrash, purgeTrashFile, type TrashItem } from '../utils/filesystem'
import { Trash2, Undo2, X } from 'lucide-react'

/** 回收站面板（附录 E E.3.6）：列出 trash/ 内笔记，支持恢复与彻底删除 */
export default function TrashPanel() {
  const [items, setItems] = useState<TrashItem[]>([])
  const restoreFromTrash = useStore((s) => s.restoreFromTrash)

  const refresh = () => {
    void listTrash()
      .then(setItems)
      .catch(() => setItems([]))
  }

  // 挂载时拉取；面板按需渲染（RightPanel 条件挂载），重新打开自动刷新
  useEffect(refresh, [])

  const handleRestore = (relPath: string) => {
    void restoreFromTrash(relPath).then(refresh)
  }

  const handlePurge = (item: TrashItem) => {
    if (!window.confirm(`彻底删除「${item.name}」？此操作不可恢复。`)) return
    void purgeTrashFile(item.relPath).then(refresh)
  }

  return (
    <div className="trash-panel">
      <div className="panel-section">
        <h3 className="panel-section-title">
          <Trash2 size={14} /> 回收站 ({items.length})
        </h3>
        {items.length === 0 ? (
          <p className="panel-empty-text">回收站为空，删除的笔记会先移到这里</p>
        ) : (
          <div className="link-list">
            {items.map((item) => (
              <div key={item.relPath} className="link-item trash-item">
                <span className="trash-item-info" title={item.relPath}>
                  <span className="trash-item-name">{item.name}</span>
                  <span className="trash-item-path">{item.relPath.slice('trash/'.length)}</span>
                </span>
                <div className="trash-item-actions">
                  <button
                    className="icon-btn-small"
                    onClick={() => handleRestore(item.relPath)}
                    title="恢复到原位置"
                  >
                    <Undo2 size={12} />
                  </button>
                  <button
                    className="icon-btn-small"
                    onClick={() => handlePurge(item)}
                    title="彻底删除"
                  >
                    <X size={12} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
