import { FileWarning } from 'lucide-react'
import { useExplorerStore } from '../../../store/explorerStore'
import { formatSize } from './fileKind'

// 文件预览：图片 base64 直显；二进制/超大文本走占位提示。

export function FilePreview({ tabId }: { tabId: string }) {
  const tab = useExplorerStore((s) => s.tabs.find((t) => t.id === tabId))
  if (!tab) return null

  if (tab.kind === 'image') {
    return (
      <div className="editor-preview-image">
        <img src={`data:${tab.mime};base64,${tab.base64}`} alt={tab.id} />
        <div className="editor-preview-meta">
          {tab.id} · {formatSize(tab.size)}
        </div>
      </div>
    )
  }

  return (
    <div className="editor-preview-empty">
      <FileWarning size={32} />
      {tab.kind === 'tooLarge' ? (
        <>
          <p>文件超过 2MB 文本编辑上限</p>
          <p className="editor-preview-meta">{tab.id} · {formatSize(tab.size)}</p>
        </>
      ) : (
        <>
          <p>二进制文件不支持预览</p>
          <p className="editor-preview-meta">{tab.id} · {formatSize(tab.size)}</p>
        </>
      )}
    </div>
  )
}
