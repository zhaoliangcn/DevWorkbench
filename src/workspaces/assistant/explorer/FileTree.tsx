import { ChevronDown, ChevronRight, FileText, FilePlus, FolderPlus, FolderOpen, Folder, Pencil, Trash2, Image as ImageIcon } from 'lucide-react'
import { useExplorerStore } from '../../../store/explorerStore'
import { extOf, isImageExt } from './fileKind'

// 目录树：懒加载展开 + 节点 hover 操作按钮（新建/重命名/删除）。
// 用按钮而非右键菜单：无菜单层级/定位/键盘导航成本，交互更直接。

interface NodeProps {
  entry: ExplorerEntry
  depth: number
}

function FileIcon({ entry }: { entry: ExplorerEntry }) {
  if (entry.kind === 'dir') return <Folder size={13} className="explorer-icon-dir" />
  if (isImageExt(extOf(entry.relPath))) return <ImageIcon size={13} className="explorer-icon-file" />
  return <FileText size={13} className="explorer-icon-file" />
}

function FileTreeNode({ entry, depth }: NodeProps) {
  const expanded = useExplorerStore((s) => !!s.expanded[entry.relPath])
  const loading = useExplorerStore((s) => !!s.loadingDirs[entry.relPath])
  const activeTabId = useExplorerStore((s) => s.activeTabId)
  const toggleDir = useExplorerStore((s) => s.toggleDir)
  const openFile = useExplorerStore((s) => s.openFile)
  const createNode = useExplorerStore((s) => s.createNode)
  const renameNode = useExplorerStore((s) => s.renameNode)
  const deleteNode = useExplorerStore((s) => s.deleteNode)

  const handleCreate = async (kind: 'file' | 'dir') => {
    const name = window.prompt(kind === 'file' ? '新建文件名（可含子目录，如 src/a.ts）' : '新建文件夹名')
    if (!name?.trim()) return
    const r = await createNode(entry.relPath, name.trim(), kind)
    if (!r.success) window.alert(`新建失败：${r.error}`)
    // 确保新条目可见（父目录未展开时展开一次）
    if (!expanded) toggleDir(entry.relPath)
  }

  const handleRename = async () => {
    const name = window.prompt('重命名为', entry.name)
    if (!name?.trim() || name.trim() === entry.name) return
    const r = await renameNode(entry.relPath, name.trim())
    if (!r.success) window.alert(`重命名失败：${r.error}`)
  }

  const handleDelete = async () => {
    if (!window.confirm(`确认删除「${entry.name}」？${entry.kind === 'dir' ? '（含全部子内容）' : ''}`)) return
    const r = await deleteNode(entry.relPath)
    if (!r.success) window.alert(`删除失败：${r.error}`)
  }

  const isActive = activeTabId === entry.relPath

  return (
    <div className="explorer-node">
      <div
        className={`explorer-node-row ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: 6 + depth * 14 }}
        onClick={() => (entry.kind === 'dir' ? toggleDir(entry.relPath) : void openFile(entry.relPath))}
        title={entry.relPath}
      >
        <span className="explorer-node-chevron">
          {entry.kind === 'dir' &&
            (loading ? <span className="explorer-spin-dot" /> : expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />)}
        </span>
        <FileIcon entry={entry} />
        <span className="explorer-node-name">{entry.name}</span>
        <span className="explorer-node-actions">
          {entry.kind === 'dir' && (
            <>
              <button
                className="explorer-node-btn"
                title="新建文件"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleCreate('file')
                }}
              >
                <FilePlus size={12} />
              </button>
              <button
                className="explorer-node-btn"
                title="新建文件夹"
                onClick={(e) => {
                  e.stopPropagation()
                  void handleCreate('dir')
                }}
              >
                <FolderPlus size={12} />
              </button>
            </>
          )}
          <button
            className="explorer-node-btn"
            title="重命名"
            onClick={(e) => {
              e.stopPropagation()
              void handleRename()
            }}
          >
            <Pencil size={12} />
          </button>
          <button
            className="explorer-node-btn danger"
            title="删除"
            onClick={(e) => {
              e.stopPropagation()
              void handleDelete()
            }}
          >
            <Trash2 size={12} />
          </button>
        </span>
      </div>
      {entry.kind === 'dir' && expanded && <ChildList parentRel={entry.relPath} depth={depth + 1} />}
    </div>
  )
}

function ChildList({ parentRel, depth }: { parentRel: string; depth: number }) {
  const children = useExplorerStore((s) => s.children[parentRel])
  if (!children) return <div className="explorer-child-empty" style={{ paddingLeft: 20 + depth * 14 }}>…</div>
  if (children.length === 0) {
    return <div className="explorer-child-empty" style={{ paddingLeft: 20 + depth * 14 }}>（空目录）</div>
  }
  return (
    <>
      {children.map((e) => (
        <FileTreeNode key={e.relPath} entry={e} depth={depth} />
      ))}
    </>
  )
}

export function FileTree() {
  const root = useExplorerStore((s) => s.root)
  const rootChildren = useExplorerStore((s) => s.children[''])
  const pickRootAndSet = useExplorerStore((s) => s.pickRootAndSet)

  if (!root) {
    return (
      <div className="explorer-tree-empty">
        <FolderOpen size={32} />
        <p>选择一个项目根目录开始浏览</p>
        <button className="assistant-btn" onClick={() => void pickRootAndSet()}>
          打开文件夹
        </button>
      </div>
    )
  }
  if (!rootChildren) return <div className="explorer-tree-empty">加载中…</div>
  if (rootChildren.length === 0) return <div className="explorer-tree-empty">（空目录）</div>
  return (
    <div className="explorer-tree">
      {rootChildren.map((e) => (
        <FileTreeNode key={e.relPath} entry={e} depth={0} />
      ))}
    </div>
  )
}
