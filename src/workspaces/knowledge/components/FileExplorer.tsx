import { useState, useMemo, useRef, useEffect } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import type { TreeNode, Folder, NoteRef } from '../../../types'
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  Plus,
  MoreVertical,
  Trash2,
  Upload,
  Download,
} from 'lucide-react'

function buildFolderTree(
  folders: Folder[],
  notes: Record<string, { id: string; title: string; path: string; tags: string[]; content: string; createdAt: number; updatedAt: number }>
): TreeNode[] {
  const root: TreeNode[] = []

  const folderMap = new Map<string, Folder>()
  const folderChildren = new Map<string, TreeNode[]>()

  for (const folder of folders) {
    folderMap.set(folder.path, { ...folder, children: [] })
    folderChildren.set(folder.path, [])
  }

  for (const note of Object.values(notes)) {
    const parts = note.path.split('/')
    parts.pop()
    const parentPath = parts.join('/')

    const noteRef: NoteRef = {
      id: note.id,
      title: note.title,
      path: note.path,
      kind: 'note',
    }

    if (parentPath && folderChildren.has(parentPath)) {
      folderChildren.get(parentPath)!.push(noteRef)
    } else {
      root.push(noteRef)
    }
  }

  for (const folder of folders) {
    const children = folderChildren.get(folder.path) || []
    const f = folderMap.get(folder.path)!
    f.children = children

    const parts = folder.path.split('/')
    parts.pop()
    const parentPath = parts.join('/')

    if (parentPath && folderChildren.has(parentPath)) {
      folderChildren.get(parentPath)!.push(f)
    } else {
      root.push(f)
    }
  }

  return root
}

function TreeNodeItem({
  node,
  depth,
}: {
  node: TreeNode
  depth: number
}) {
  const [expanded, setExpanded] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)
  const [moveMenuOpen, setMoveMenuOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null)
  const activeNoteId = useStore((s) => s.activeNoteId)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const deleteNote = useStore((s) => s.deleteNote)
  const deleteFolder = useStore((s) => s.deleteFolder)
  const exportNote = useStore((s) => s.exportNote)
  const moveNote = useStore((s) => s.moveNote)
  const folders = useStore((s) => s.folders)

  useEffect(() => {
    if (!contextMenuPos) return

    const handleClick = () => setContextMenuPos(null)
    document.addEventListener('click', handleClick)
    return () => document.removeEventListener('click', handleClick)
  }, [contextMenuPos])

  if ('kind' in node && node.kind === 'note') {
    const noteRef = node as NoteRef
    const isActive = activeNoteId === noteRef.id

    const handleDragStart = (e: React.DragEvent) => {
      e.dataTransfer.setData('text/plain', noteRef.id)
      e.dataTransfer.effectAllowed = 'move'
    }

    const handleContextMenu = (e: React.MouseEvent) => {
      e.preventDefault()
      e.stopPropagation()
      setContextMenuPos({ x: e.clientX, y: e.clientY })
    }

    return (
      <div
        className={`tree-item note-item ${isActive ? 'active' : ''}`}
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => setActiveNote(noteRef.id)}
        onContextMenu={handleContextMenu}
        draggable
        onDragStart={handleDragStart}
      >
        <FileText size={14} className="tree-icon" />
        <span className="tree-label">{noteRef.title}</span>
        <div className="tree-actions">
          <button
            className="icon-btn-small"
            onClick={(e) => {
              e.stopPropagation()
              setMoveMenuOpen(!moveMenuOpen)
            }}
            title="移动到文件夹"
          >
            <Upload size={12} />
          </button>
          <button
            className="icon-btn-small"
            onClick={(e) => {
              e.stopPropagation()
              exportNote(noteRef.id)
            }}
            title="导出笔记"
          >
            <Download size={12} />
          </button>
          <button
            className="icon-btn-small"
            onClick={(e) => {
              e.stopPropagation()
              deleteNote(noteRef.id)
            }}
            title="删除笔记"
          >
            <Trash2 size={12} />
          </button>
          {moveMenuOpen && (
            <div className="context-menu move-menu">
              <div
                className="menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  moveNote(noteRef.id, '')
                  setMoveMenuOpen(false)
                }}
              >
                <FolderIcon size={12} /> 根目录
              </div>
              {folders.map((folder) => (
                <div
                  key={folder.id}
                  className="menu-item"
                  onClick={(e) => {
                    e.stopPropagation()
                    moveNote(noteRef.id, folder.path)
                    setMoveMenuOpen(false)
                  }}
                >
                  <FolderIcon size={12} /> {folder.name}
                </div>
              ))}
            </div>
          )}
        </div>
        {contextMenuPos && (
          <div
            className="context-menu"
            style={{
              position: 'fixed',
              left: contextMenuPos.x,
              top: contextMenuPos.y,
            }}
          >
            <div
              className="menu-item"
              onClick={(e) => {
                e.stopPropagation()
                exportNote(noteRef.id)
                setContextMenuPos(null)
              }}
            >
              <Download size={12} /> 导出笔记
            </div>
            <div
              className="menu-item"
              onClick={(e) => {
                e.stopPropagation()
                deleteNote(noteRef.id)
                setContextMenuPos(null)
              }}
            >
              <Trash2 size={12} /> 删除笔记
            </div>
            <div className="menu-divider" />
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="menu-item"
                onClick={(e) => {
                  e.stopPropagation()
                  moveNote(noteRef.id, folder.path)
                  setContextMenuPos(null)
                }}
              >
                <Upload size={12} /> 移动到 {folder.name}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const folder = node as Folder

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    setIsDragOver(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    const noteId = e.dataTransfer.getData('text/plain')
    if (noteId) {
      moveNote(noteId, folder.path)
    }
  }

  const handleFolderContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenuPos({ x: e.clientX, y: e.clientY })
  }

  return (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      onContextMenu={handleFolderContextMenu}
      className={isDragOver ? 'folder-drag-over' : ''}
    >
      <div
        className="tree-item folder-item"
        style={{ paddingLeft: depth * 16 + 8 }}
        onClick={() => setExpanded(!expanded)}
      >
        <span className="tree-chevron">
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
        {expanded ? (
          <FolderOpen size={14} className="tree-icon" />
        ) : (
          <FolderIcon size={14} className="tree-icon" />
        )}
        <span className="tree-label">{folder.name}</span>
        <div className="tree-actions">
          <button
            className="icon-btn-small"
            onClick={(e) => {
              e.stopPropagation()
              setMenuOpen(!menuOpen)
            }}
            title="更多操作"
          >
            <MoreVertical size={12} />
          </button>
          {menuOpen && (
            <div className="context-menu">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  useStore.getState().createNote(folder.path)
                  setMenuOpen(false)
                }}
              >
                <Plus size={12} /> 新建笔记
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  deleteFolder(folder.path)
                  setMenuOpen(false)
                }}
              >
                <Trash2 size={12} /> 删除文件夹
              </button>
            </div>
          )}
        </div>
      </div>
      {contextMenuPos && (
        <div
          className="context-menu"
          style={{
            position: 'fixed',
            left: contextMenuPos.x,
            top: contextMenuPos.y,
          }}
        >
          <div
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation()
              useStore.getState().createNote(folder.path)
              setContextMenuPos(null)
            }}
          >
            <Plus size={12} /> 新建笔记
          </div>
          <div
            className="menu-item"
            onClick={(e) => {
              e.stopPropagation()
              deleteFolder(folder.path)
              setContextMenuPos(null)
            }}
          >
            <Trash2 size={12} /> 删除文件夹
          </div>
        </div>
      )}
      {expanded &&
        folder.children.map((child) => (
          <TreeNodeItem
            key={'kind' in child && child.kind === 'note' ? child.id : (child as Folder).id}
            node={child}
            depth={depth + 1}
          />
        ))}
    </div>
  )
}

export default function FileExplorer() {
  const notes = useStore((s) => s.notes)
  const folders = useStore((s) => s.folders)
  const createNote = useStore((s) => s.createNote)
  const createFolder = useStore((s) => s.createFolder)
  const importNote = useStore((s) => s.importNote)
  const [newFolderName, setNewFolderName] = useState('')
  const [showNewFolder, setShowNewFolder] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const folderTree = useMemo(() => buildFolderTree(folders, notes), [folders, notes])

  const handleCreateFolder = () => {
    if (newFolderName.trim()) {
      createFolder('', newFolderName.trim())
      setNewFolderName('')
      setShowNewFolder(false)
    }
  }

  const handleImportClick = () => {
    fileInputRef.current?.click()
  }

  const handleFilesSelected = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files
    if (!files || files.length === 0) return

    const mdFiles = Array.from(files).filter(
      (f) => f.name.endsWith('.md') || f.type === 'text/markdown'
    )

    if (mdFiles.length === 0) {
      alert('未检测到 .md 文件，请选择 Markdown 文件')
      return
    }

    for (const file of mdFiles) {
      const reader = new FileReader()
      reader.onload = (event) => {
        const content = event.target?.result as string
        const title = file.name.replace(/\.md$/i, '')
        importNote(title, content)
      }
      reader.readAsText(file)
    }

    e.target.value = ''
  }

  return (
    <div className="file-explorer">
      <input
        ref={fileInputRef}
        type="file"
        accept=".md,.markdown,text/markdown"
        multiple
        style={{ display: 'none' }}
        onChange={handleFilesSelected}
      />

      <div className="explorer-header">
        <span className="explorer-title">文件</span>
        <div className="explorer-actions">
          <button
            className="icon-btn"
            onClick={handleImportClick}
            title="导入 Markdown 文件"
          >
            <Upload size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => createNote()}
            title="新建笔记"
          >
            <Plus size={16} />
          </button>
          <button
            className="icon-btn"
            onClick={() => setShowNewFolder(!showNewFolder)}
            title="新建文件夹"
          >
            <FolderIcon size={16} />
          </button>
        </div>
      </div>

      {showNewFolder && (
        <div className="new-folder-input">
          <input
            type="text"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreateFolder()
              if (e.key === 'Escape') setShowNewFolder(false)
            }}
            placeholder="文件夹名称..."
            autoFocus
          />
        </div>
      )}

      <div className="explorer-tree">
        {folderTree.map((node) => (
          <TreeNodeItem
            key={
              'kind' in node && node.kind === 'note'
                ? node.id
                : (node as Folder).id
            }
            node={node}
            depth={0}
          />
        ))}
        {folderTree.length === 0 && (
          <div className="empty-tree">点击 + 创建笔记或文件夹</div>
        )}
      </div>
    </div>
  )
}
