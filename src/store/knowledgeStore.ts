import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Note, Folder, Link, RightPanelTab, Theme, TreeNode, NoteRef, AiConfig } from '../types'
import { useAppStore } from './appStore'
import {
  buildLinks,
  generateNoteId,
  generateFolderId,
  sanitizeFileName,
  extractUnresolved,
  findUnlinkedMentions,
  canBeWikiTarget,
} from '../workspaces/knowledge/utils/markdown'
import { extractAllTags } from '../workspaces/knowledge/utils/frontmatter'
import {
  renderTemplate,
  todayStr,
  TEMPLATE_DIR,
  DEFAULT_DAILY_TEMPLATE,
} from '../workspaces/knowledge/utils/template'
import { rankSearch } from '../workspaces/knowledge/utils/search'
import type { SearchHit } from '../workspaces/knowledge/utils/search'
import { getDefaultConfig } from '../workspaces/knowledge/utils/ai'
import {
  openVault as fsOpenVault,
  isVaultOpen,
  writeFile,
  readFile,
  deleteFile,
  moveFile,
  createDirectory,
  deleteDirectory,
  listAllFiles,
  listDirectories,
  exportFile,
  restoreTrashFile,
  subscribeVaultChanges,
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
  /** vault/templates/ 下的模板（id = 文件名去 .md → 内容）；不持久化，随 vault 加载刷新 */
  templates: Record<string, string>
  /** 已钉到 AI 助手的笔记 id（发送消息时作为上下文，见设计文档 C.5） */
  pinnedForAssistant: string[]

  createNote: (folderPath?: string, options?: { templateId?: string }) => string
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
  /** 未解析出链（死链）标题列表，按出现顺序去重（附录 E E.3.1） */
  getUnresolved: (noteId: string) => string[]
  /** 未链接提及：正文纯文本中提到、但未用 [[ ]] 链接的其他笔记（附录 E E.3.1） */
  getUnlinkedMentions: (noteId: string) => { id: string; title: string }[]
  /** 按标题取笔记或一键创建（死链生长）；返回笔记 id 并设为当前 */
  createNoteWithTitle: (title: string) => string
  getNotesByTag: (tag: string) => Note[]
  getAllTags: () => string[]
  getNoteByTitle: (title: string) => Note | undefined
  getFolderTree: () => TreeNode[]
  /** 全文搜索（附录 E E.3.2）：排序命中（标题×3/标签×2/正文×1）+ 正文片段 */
  searchNotes: (query: string) => SearchHit[]
  navigateToNote: (title: string) => void
  importNote: (title: string, content: string, folderPath?: string) => string
  /** 每日笔记（附录 E E.3.4）：YYYY-MM-DD.md 已存在则打开，否则按 daily 模板创建（幂等） */
  createDailyNote: () => string
  /** 外部 vault 变更增量合并（附录 E E.3.6）：以磁盘为准 upsert/remove */
  applyVaultChange: (change: { relPath: string; kind: 'add' | 'change' | 'unlink' }) => void
  /** 从回收站恢复笔记（附录 E E.3.6）：移回原路径并打开 */
  restoreFromTrash: (relPath: string) => Promise<void>
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

/** 以磁盘为准 upsert 一篇笔记（附录 E E.3.6 增量合并）；返回 note id，读取失败返回 null */
async function upsertNoteFromDisk(relPath: string): Promise<string | null> {
  let content: string
  try {
    content = await readFile(relPath)
  } catch {
    return null
  }
  const title = relPath.split('/').pop()!.replace(/\.md$/i, '')
  const now = Date.now()

  useStore.setState((state) => {
    const existing = Object.values(state.notes).find((n) => n.path === relPath)
    const note: Note = existing
      ? { ...existing, title, content, tags: extractAllTags(content), updatedAt: now }
      : {
          id: generateNoteId(),
          title,
          content,
          path: relPath,
          createdAt: now,
          updatedAt: now,
          tags: extractAllTags(content),
        }
    return { notes: { ...state.notes, [note.id]: note } }
  })
  return Object.values(useStore.getState().notes).find((n) => n.path === relPath)?.id ?? null
}

/** 模板文件增量合并 */
async function upsertTemplateFromDisk(id: string, relPath: string): Promise<void> {
  try {
    const content = await readFile(relPath)
    useStore.setState((state) => ({ templates: { ...state.templates, [id]: content } }))
  } catch {
    // 文件已消失：保留旧模板直至下一次全量加载
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
      templates: {},
      pinnedForAssistant: [],

      createNote: (folderPath?: string, options?: { templateId?: string }) => {
        const id = generateNoteId()
        const title = '未命名笔记'
        const fileName = sanitizeFileName(title) + '.md'
        const path = folderPath ? `${folderPath}/${fileName}` : fileName
        const now = Date.now()

        // 指定模板则渲染占位符（附录 E E.3.4）；模板缺失回退空笔记
        const template = options?.templateId ? get().templates[options.templateId] : undefined
        const content = template ? renderTemplate(template, { title, date: todayStr() }) : ''

        const note: Note = {
          id,
          title,
          content,
          path,
          createdAt: now,
          updatedAt: now,
          tags: [],
        }

        syncWriteFile(path, content)

        set((state) => ({
          notes: { ...state.notes, [id]: note },
          activeNoteId: id,
        }))

        return id
      },

      deleteNote: (id: string) => {
        const note = get().notes[id]
        if (note) {
          // 回收站（附录 E E.3.6）：移入 trash/ 保留相对路径（恢复时剥离前缀回原位），替代直删
          syncMoveFile(note.path, `trash/${note.path}`)
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
          const tags = extractAllTags(content)

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

      getUnresolved: (noteId: string) => {
        const { notes } = get()
        const note = notes[noteId]
        if (!note) return []

        const titleToId = new Map<string, string>()
        for (const n of Object.values(notes)) {
          titleToId.set(n.title, n.id)
        }

        return extractUnresolved(note.content, titleToId)
      },

      getUnlinkedMentions: (noteId: string) => {
        const { notes } = get()
        const note = notes[noteId]
        if (!note) return []

        const others = Object.values(notes).filter(
          (n) => n.id !== noteId && canBeWikiTarget(n.title)
        )
        const mentioned = findUnlinkedMentions(
          note.content,
          others.map((n) => n.title)
        )
        return others.filter((n) => mentioned.includes(n.title))
      },

      createNoteWithTitle: (title: string) => {
        const existing = get().getNoteByTitle(title)
        if (existing) {
          set({ activeNoteId: existing.id })
          return existing.id
        }
        const id = get().importNote(title, `# ${title}\n`)
        set({ activeNoteId: id })
        return id
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
        return rankSearch(Object.values(get().notes), query)
      },

      navigateToNote: (title: string) => {
        const note = get().getNoteByTitle(title)
        if (note) {
          set({ activeNoteId: note.id })
        }
      },

      createDailyNote: () => {
        const date = todayStr()
        // 幂等：按磁盘文件名（path）找当日笔记，存在即打开
        const existing = Object.values(get().notes).find((n) => n.path === `${date}.md`)
        if (existing) {
          set({ activeNoteId: existing.id })
          return existing.id
        }
        const template = get().templates['daily'] ?? DEFAULT_DAILY_TEMPLATE
        const id = get().importNote(date, renderTemplate(template, { title: date, date }))
        set({ activeNoteId: id })
        return id
      },

      applyVaultChange: (change) => {
        const { relPath, kind } = change
        // 回收站/附件不进笔记树（主进程已过滤，此处兜底）
        if (relPath.startsWith('trash/') || relPath.startsWith('attachments/')) return

        // 模板目录：维护 templates 表
        if (relPath.startsWith(TEMPLATE_DIR)) {
          const id = relPath.slice(TEMPLATE_DIR.length).replace(/\.md$/i, '')
          if (kind === 'unlink') {
            set((state) => {
              const { [id]: _removed, ...rest } = state.templates
              return { templates: rest }
            })
            return
          }
          void upsertTemplateFromDisk(id, relPath)
          return
        }

        if (!relPath.endsWith('.md')) return

        if (kind === 'unlink') {
          set((state) => {
            const target = Object.values(state.notes).find((n) => n.path === relPath)
            if (!target) return state
            const { [target.id]: _removed, ...rest } = state.notes
            return {
              notes: rest,
              // 活动笔记被外部删除时切到剩余第一篇
              activeNoteId:
                state.activeNoteId === target.id ? Object.keys(rest)[0] || null : state.activeNoteId,
              pinnedForAssistant: state.pinnedForAssistant.filter((p) => p !== target.id),
            }
          })
          return
        }

        // add / change：以磁盘为准（自写回声由主进程静默窗口拦截）
        void upsertNoteFromDisk(relPath)
      },

      restoreFromTrash: async (relPath: string) => {
        try {
          const { path: restoredPath } = await restoreTrashFile(relPath)
          const id = await upsertNoteFromDisk(restoredPath)
          if (id) set({ activeNoteId: id })
        } catch {
          // 恢复失败静默（主进程已做路径校验与重名处理）
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
        const tags = extractAllTags(content)

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

          // vault 约定目录（附录 E E.3.4/E.3.5）：templates/ 归入模板、attachments/ 附件不进笔记树
          const loadedTemplates: Record<string, string> = {}
          const noteFiles = files.filter((f) => {
            if (f.path.startsWith(TEMPLATE_DIR)) {
              loadedTemplates[f.name.replace(/\.md$/i, '')] = f.content
              return false
            }
            return true
          })
          const isReservedDir = (d: string) =>
            d === 'templates' || d.startsWith(TEMPLATE_DIR) || d === 'attachments' || d.startsWith('attachments/')
          const templateDirs = dirs.filter((d) => !isReservedDir(d))

          const loadedNotes: Record<string, Note> = {}
          const loadedFolders: Folder[] = templateDirs.map((d) => ({
            id: generateFolderId(),
            name: d.split('/').pop() || d,
            path: d,
            children: [],
          }))

          for (const file of noteFiles) {
            const id = generateNoteId()
            loadedNotes[id] = {
              id,
              title: file.name,
              content: file.content,
              path: file.path,
              createdAt: now,
              updatedAt: now,
              tags: extractAllTags(file.content),
            }
          }

          const firstId = Object.keys(loadedNotes)[0] || null
          set({
            notes: loadedNotes,
            folders: loadedFolders,
            templates: loadedTemplates,
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

// vault 监听订阅（附录 E E.3.6）：store 为应用级单例，模块生命周期内常驻，无需清理
if (typeof window !== 'undefined') {
  subscribeVaultChanges((change) => useStore.getState().applyVaultChange(change))
}
