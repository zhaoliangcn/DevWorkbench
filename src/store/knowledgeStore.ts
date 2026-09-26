import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Note, Folder, Link, RightPanelTab, Theme, TreeNode, NoteRef, AiConfig } from '../types'
import { useAppStore } from './appStore'
import {
  extractTags,
  buildLinks,
  generateNoteId,
  generateFolderId,
  sanitizeFileName,
} from '../workspaces/knowledge/utils/markdown'
import { getDefaultConfig } from '../workspaces/knowledge/utils/ai'
import {
  openVault as fsOpenVault,
  isVaultOpen,
  writeFile,
  deleteFile,
  moveFile,
  createDirectory,
  deleteDirectory,
  listAllFiles,
  listDirectories,
  exportFile,
} from '../workspaces/knowledge/utils/filesystem'

interface AppState {
  notes: Record<string, Note>
  folders: Folder[]
  activeNoteId: string | null
  sidebarVisible: boolean
  rightPanelVisible: boolean
  rightPanelTab: RightPanelTab
  rightPanelWidth: number
  theme: Theme
  searchQuery: string
  aiConfig: AiConfig
  vaultName: string | null
  vaultReady: boolean
  /** 已钉到 AI 助手的笔记 id（发送消息时作为上下文，见设计文档 C.5） */
  pinnedForAssistant: string[]

  createNote: (folderPath?: string) => string
  deleteNote: (id: string) => void
  moveNote: (id: string, targetFolderPath: string) => void
  updateNoteContent: (id: string, content: string) => void
  updateNoteTitle: (id: string, title: string) => void
  setActiveNote: (id: string | null) => void
  toggleSidebar: () => void
  toggleRightPanel: () => void
  setRightPanelTab: (tab: RightPanelTab) => void
  setRightPanelWidth: (width: number) => void
  setTheme: (theme: Theme) => void
  setSearchQuery: (query: string) => void
  createFolder: (parentPath: string, name: string) => void
  deleteFolder: (path: string) => void
  getAllLinks: () => Link[]
  getBacklinks: (noteId: string) => Link[]
  getOutlinks: (noteId: string) => Link[]
  getNotesByTag: (tag: string) => Note[]
  getAllTags: () => string[]
  getNoteByTitle: (title: string) => Note | undefined
  getFolderTree: () => TreeNode[]
  searchNotes: (query: string) => Note[]
  navigateToNote: (title: string) => void
  importNote: (title: string, content: string, folderPath?: string) => string
  togglePinForAssistant: (id: string) => void
  updateAiConfig: (config: Partial<AiConfig>) => void
  openVault: () => Promise<void>
  loadVaultFromDisk: () => Promise<void>
  exportNote: (id: string) => Promise<void>
}

function buildFolderTree(
  folders: Folder[],
  notes: Record<string, Note>
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

function createDefaultNotes(): Record<string, Note> {
  const now = Date.now()
  const welcomeId = generateNoteId()
  const gettingStartedId = generateNoteId()

  return {
    [welcomeId]: {
      id: welcomeId,
      title: '欢迎使用 MyObsidian',
      content: `# 欢迎使用 MyObsidian

这是一个参考 Obsidian 设计的 Markdown 知识库管理工具。

## 核心功能

- **Markdown 编辑**：支持编辑、预览、分屏三种模式
- **Wiki 链接**：使用 \`[[笔记名称]]\` 创建笔记之间的链接
- **知识图谱**：可视化笔记之间的关联关系
- **反向链接**：查看哪些笔记引用了当前笔记
- **标签系统**：使用 \`#标签\` 组织笔记
- **全局搜索**：快速查找笔记内容

## 快速开始

查看 [[快速入门]] 了解更多使用技巧。

## 标签示例

这是一个 #示例 标签，你可以使用 #知识管理 和 #Markdown 来组织内容。
`,
      path: '欢迎使用 MyObsidian.md',
      createdAt: now,
      updatedAt: now,
      tags: ['示例', '知识管理', 'Markdown'],
    },
    [gettingStartedId]: {
      id: gettingStartedId,
      title: '快速入门',
      content: `# 快速入门

## 创建笔记

点击左侧边栏的 **新建笔记** 按钮，或使用文件夹组织你的笔记。

## 链接笔记

使用 \`[[笔记名称]]\` 语法创建到其他笔记的链接。例如：[[欢迎使用 MyObsidian]]

## 使用标签

在笔记中使用 \`#标签名\` 来添加标签，标签会显示在标签面板中。

## 知识图谱

点击右侧面板的图谱视图，查看笔记之间的关联关系。

## 搜索

使用 \`Cmd/Ctrl + K\` 打开搜索面板，快速查找笔记。
`,
      path: '快速入门.md',
      createdAt: now,
      updatedAt: now,
      tags: ['入门', '教程'],
    },
  }
}

function syncWriteFile(path: string, content: string) {
  if (isVaultOpen()) {
    writeFile(path, content).catch(() => {})
  }
}

function syncDeleteFile(path: string) {
  if (isVaultOpen()) {
    deleteFile(path).catch(() => {})
  }
}

function syncMoveFile(oldPath: string, newPath: string) {
  if (isVaultOpen()) {
    moveFile(oldPath, newPath).catch(() => {})
  }
}

function syncCreateDir(path: string) {
  if (isVaultOpen()) {
    createDirectory(path).catch(() => {})
  }
}

function syncDeleteDir(path: string) {
  if (isVaultOpen()) {
    deleteDirectory(path).catch(() => {})
  }
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      notes: createDefaultNotes(),
      folders: [],
      activeNoteId: Object.keys(createDefaultNotes())[0],
      sidebarVisible: true,
      rightPanelVisible: true,
      rightPanelTab: 'backlinks',
      rightPanelWidth: 300,
      theme: 'dark',
      searchQuery: '',
      aiConfig: getDefaultConfig('ollama'),
      vaultName: null,
      vaultReady: false,
      pinnedForAssistant: [],

      createNote: (folderPath?: string) => {
        const id = generateNoteId()
        const title = '未命名笔记'
        const fileName = sanitizeFileName(title) + '.md'
        const path = folderPath ? `${folderPath}/${fileName}` : fileName
        const now = Date.now()

        const note: Note = {
          id,
          title,
          content: '',
          path,
          createdAt: now,
          updatedAt: now,
          tags: [],
        }

        syncWriteFile(path, '')

        set((state) => ({
          notes: { ...state.notes, [id]: note },
          activeNoteId: id,
        }))

        return id
      },

      deleteNote: (id: string) => {
        const note = get().notes[id]
        if (note) {
          syncDeleteFile(note.path)
        }

        set((state) => {
          const { [id]: _removed, ...rest } = state.notes
          const newActiveId =
            state.activeNoteId === id
              ? Object.keys(rest)[0] || null
              : state.activeNoteId
          return {
            notes: rest,
            activeNoteId: newActiveId,
            // 删除笔记时同步清理钉选，避免悬空引用
            pinnedForAssistant: state.pinnedForAssistant.filter((p) => p !== id),
          }
        })
      },

      moveNote: (id: string, targetFolderPath: string) => {
        set((state) => {
          const note = state.notes[id]
          if (!note) return state

          const oldPath = note.path
          const fileName = oldPath.split('/').pop()!
          const newPath = targetFolderPath ? `${targetFolderPath}/${fileName}` : fileName

          syncMoveFile(oldPath, newPath)

          return {
            notes: {
              ...state.notes,
              [id]: { ...note, path: newPath, updatedAt: Date.now() },
            },
          }
        })
      },

      updateNoteContent: (id: string, content: string) => {
        set((state) => {
          const note = state.notes[id]
          if (!note) return state
          const tags = extractTags(content)

          syncWriteFile(note.path, content)

          return {
            notes: {
              ...state.notes,
              [id]: { ...note, content, tags, updatedAt: Date.now() },
            },
          }
        })
      },

      updateNoteTitle: (id: string, title: string) => {
        set((state) => {
          const note = state.notes[id]
          if (!note) return state
          const sanitized = sanitizeFileName(title)
          const parts = note.path.split('/')
          const oldPath = note.path
          parts[parts.length - 1] = sanitized + '.md'
          const newPath = parts.join('/')

          if (isVaultOpen()) {
            if (note.content) {
              writeFile(newPath, note.content).catch(() => {})
            }
            deleteFile(oldPath).catch(() => {})
          }

          return {
            notes: {
              ...state.notes,
              [id]: { ...note, title, path: newPath, updatedAt: Date.now() },
            },
          }
        })
      },

      setActiveNote: (id) => set({ activeNoteId: id }),

      toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),

      toggleRightPanel: () =>
        set((s) => ({ rightPanelVisible: !s.rightPanelVisible })),

      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),

      setRightPanelWidth: (width) => set({ rightPanelWidth: width }),

      setTheme: (theme) => {
        // 全局主题以 appStore 为单一数据源
        useAppStore.getState().setTheme(theme)
        set({ theme })
      },

      setSearchQuery: (query) => set({ searchQuery: query }),

      createFolder: (parentPath: string, name: string) => {
        const path = parentPath ? `${parentPath}/${name}` : name
        syncCreateDir(path)

        const folder: Folder = {
          id: generateFolderId(),
          name,
          path,
          children: [],
        }
        set((state) => ({ folders: [...state.folders, folder] }))
      },

      deleteFolder: (path: string) => {
        syncDeleteDir(path)

        set((state) => {
          const folders = state.folders.filter(
            (f) => f.path !== path && !f.path.startsWith(path + '/')
          )
          const notes = { ...state.notes }
          for (const id of Object.keys(notes)) {
            if (notes[id].path.startsWith(path + '/')) {
              delete notes[id]
            }
          }
          return { folders, notes }
        })
      },

      getAllLinks: () => {
        const { notes } = get()
        const titleToId = new Map<string, string>()
        for (const note of Object.values(notes)) {
          titleToId.set(note.title, note.id)
        }

        const allLinks: Link[] = []
        for (const note of Object.values(notes)) {
          const links = buildLinks(note.id, note.title, note.content, titleToId)
          allLinks.push(...links)
        }
        return allLinks
      },

      getBacklinks: (noteId: string) => {
        const { notes } = get()
        const note = notes[noteId]
        if (!note) return []

        const titleToId = new Map<string, string>()
        for (const n of Object.values(notes)) {
          titleToId.set(n.title, n.id)
        }

        const backlinks: Link[] = []
        for (const other of Object.values(notes)) {
          if (other.id === noteId) continue
          const links = buildLinks(other.id, other.title, other.content, titleToId)
          for (const link of links) {
            if (link.target === noteId) {
              backlinks.push(link)
            }
          }
        }
        return backlinks
      },

      getOutlinks: (noteId: string) => {
        const { notes } = get()
        const note = notes[noteId]
        if (!note) return []

        const titleToId = new Map<string, string>()
        for (const n of Object.values(notes)) {
          titleToId.set(n.title, n.id)
        }

        return buildLinks(note.id, note.title, note.content, titleToId)
      },

      getNotesByTag: (tag: string) => {
        return Object.values(get().notes).filter((n) => n.tags.includes(tag))
      },

      getAllTags: () => {
        const tagSet = new Set<string>()
        for (const note of Object.values(get().notes)) {
          for (const tag of note.tags) {
            tagSet.add(tag)
          }
        }
        return [...tagSet].sort()
      },

      getNoteByTitle: (title: string) => {
        return Object.values(get().notes).find((n) => n.title === title)
      },

      getFolderTree: () => {
        return buildFolderTree(get().folders, get().notes)
      },

      searchNotes: (query: string) => {
        if (!query.trim()) return []
        const q = query.toLowerCase()
        return Object.values(get().notes).filter(
          (n) =>
            n.title.toLowerCase().includes(q) ||
            n.content.toLowerCase().includes(q) ||
            n.tags.some((t) => t.toLowerCase().includes(q))
        )
      },

      navigateToNote: (title: string) => {
        const note = get().getNoteByTitle(title)
        if (note) {
          set({ activeNoteId: note.id })
        }
      },

      importNote: (title: string, content: string, folderPath?: string) => {
        const { notes } = get()

        let finalTitle = title
        let counter = 1
        while (Object.values(notes).some((n) => n.title === finalTitle)) {
          finalTitle = `${title} (${counter})`
          counter++
        }

        const id = generateNoteId()
        const fileName = sanitizeFileName(finalTitle) + '.md'
        const path = folderPath ? `${folderPath}/${fileName}` : fileName
        const now = Date.now()
        const tags = extractTags(content)

        syncWriteFile(path, content)

        const note: Note = {
          id,
          title: finalTitle,
          content,
          path,
          createdAt: now,
          updatedAt: now,
          tags,
        }

        set((state) => ({
          notes: { ...state.notes, [id]: note },
        }))

        return id
      },

      togglePinForAssistant: (id: string) => {
        set((state) => ({
          pinnedForAssistant: state.pinnedForAssistant.includes(id)
            ? state.pinnedForAssistant.filter((p) => p !== id)
            : [...state.pinnedForAssistant, id],
        }))
      },

      updateAiConfig: (config: Partial<AiConfig>) => {
        set((state) => ({
          aiConfig: { ...state.aiConfig, ...config },
        }))
      },

      openVault: async () => {
        const result = await fsOpenVault()
        if (result) {
          set({ vaultName: result.name, vaultReady: true })
          await get().loadVaultFromDisk()
        }
      },

      loadVaultFromDisk: async () => {
        if (!isVaultOpen()) return

        try {
          const files = await listAllFiles()
          const dirs = await listDirectories()
          const now = Date.now()

          const loadedNotes: Record<string, Note> = {}
          const loadedFolders: Folder[] = dirs.map((d) => ({
            id: generateFolderId(),
            name: d.split('/').pop() || d,
            path: d,
            children: [],
          }))

          for (const file of files) {
            const id = generateNoteId()
            loadedNotes[id] = {
              id,
              title: file.name,
              content: file.content,
              path: file.path,
              createdAt: now,
              updatedAt: now,
              tags: extractTags(file.content),
            }
          }

          const firstId = Object.keys(loadedNotes)[0] || null
          set({
            notes: loadedNotes,
            folders: loadedFolders,
            activeNoteId: firstId,
          })
        } catch {
          set({ vaultReady: true })
        }
      },

      exportNote: async (id: string) => {
        const note = get().notes[id]
        if (!note) return
        await exportFile(note.path, note.content)
      },
    }),
    {
      name: 'my-obsidian-storage',
      partialize: (state) => ({
        notes: state.notes,
        folders: state.folders,
        activeNoteId: state.activeNoteId,
        aiConfig: state.aiConfig,
        theme: state.theme,
        pinnedForAssistant: state.pinnedForAssistant,
      }),
    }
  )
)
