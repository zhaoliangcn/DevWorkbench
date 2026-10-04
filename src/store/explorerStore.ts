import { create } from 'zustand'
import { extOf, isImageExt, monacoLanguageOf } from '../workspaces/assistant/explorer/fileKind'
import { useAssistantStore } from './assistantStore'

// 开发助手：项目文件浏览与编辑状态（explorer 域）
// 最近项目列表经 data:save/load 持久化（userData 下 JSON）；树/标签为会话态不持久化。

const DATA_KEY = 'devworkbench-explorer'
const MAX_RECENTS = 8

/**
 * 左侧选择项目根后联动 AI 助手工作目录：同步 assistantStore.workingDir，
 * 助手运行中则按新目录幂等重启（assistant:start 停旧启新）；未运行时仅记录，
 * 下次启动生效。设置页向左联动由 SettingsWorkspace 直接调 setRoot 完成。
 */
function syncAssistantWorkdir(path: string) {
  const st = useAssistantStore.getState()
  if (st.workingDir === path) return
  st.setWorkingDir(path)
  const api = window.electronAPI?.assistant
  if (!api || !st.status?.running) return
  const active = st.models.find((m) => m.name === st.activeModel) ?? st.models[0]
  // 模型未就绪（无 key 且非 ollama）时不重启，避免无谓报错
  if (!active || (active.apiKey.length === 0 && active.provider !== 'ollama')) return
  void (async () => {
    try {
      const res = await api.start({
        models: st.models,
        schedulerEnabled: true,
        approvalEnabled: st.approvalEnabled,
        policy: st.policy,
        workingDir: path || undefined,
      })
      const next = useAssistantStore.getState()
      next.setStatus(res.status)
      if (res.error) next.setError(res.error)
      // 技能模式在助手重启后重放工具过滤器（H.2）
      const act = next.activeSkill
      if (!res.error && act?.tools) void api.setToolFilter(act.tools)
    } catch (e) {
      useAssistantStore.getState().setError(e instanceof Error ? e.message : String(e))
    }
  })()
}

export interface ExplorerTab {
  id: string
  /** relPath，'/' 分隔 */
  kind: 'text' | 'image' | 'binary' | 'tooLarge'
  language: string
  /** 文本内容（text） */
  content: string
  /** 打开/保存时快照，脏判断基准 */
  original: string
  /** 图片 base64（image） */
  base64: string
  mime: string
  dirty: boolean
  size: number
  mtime: number
  locked: boolean
}

interface RecentRoot {
  path: string
  name: string
}

interface ExplorerStore {
  root: string
  rootName: string
  recentRoots: RecentRoot[]
  /** 面板显隐（header 按钮切换） */
  panelVisible: boolean
  expanded: Record<string, boolean>
  children: Record<string, ExplorerEntry[]>
  loadingDirs: Record<string, boolean>
  tabs: ExplorerTab[]
  activeTabId: string | null

  init: () => Promise<void>
  /** 弹系统对话框选项目根，成功后 setRoot（ExplorerPanel/FileTree 空态共用） */
  pickRootAndSet: () => Promise<void>
  setRoot: (path: string, name: string) => void
  togglePanel: () => void
  toggleDir: (rel: string) => void
  loadDir: (rel: string) => Promise<void>
  refreshDir: (rel: string) => Promise<void>
  openFile: (rel: string) => Promise<void>
  closeTab: (id: string) => void
  setActiveTab: (id: string) => void
  updateContent: (id: string, content: string) => void
  saveTab: (id: string) => Promise<{ success: boolean; error?: string }>
  toggleLocked: (id: string) => void
  createNode: (parentRel: string, name: string, kind: 'file' | 'dir') => Promise<{ success: boolean; error?: string }>
  renameNode: (rel: string, newName: string) => Promise<{ success: boolean; error?: string }>
  deleteNode: (rel: string) => Promise<{ success: boolean; error?: string }>
}

/** rel 目录路径 → 父目录 rel（root 自身无父） */
function parentOf(rel: string): string | null {
  const idx = rel.lastIndexOf('/')
  return idx > 0 ? rel.slice(0, idx) : ''
}

/** 删除以某 rel 为前缀的树缓存/展开态（重命名/删除目录后调用） */
function prunePrefix(state: { expanded: Record<string, boolean>; children: Record<string, ExplorerEntry[]> }, rel: string) {
  const prefix = `${rel}/`
  for (const key of Object.keys(state.expanded)) {
    if (key === rel || key.startsWith(prefix)) delete state.expanded[key]
  }
  for (const key of Object.keys(state.children)) {
    if (key === rel || key.startsWith(prefix)) delete state.children[key]
  }
}

function explorerAPI() {
  return window.electronAPI?.explorer
}

export const useExplorerStore = create<ExplorerStore>()((set, get) => ({
  root: '',
  rootName: '',
  recentRoots: [],
  panelVisible: true,
  expanded: {},
  children: {},
  loadingDirs: {},
  tabs: [],
  activeTabId: null,

  init: async () => {
    const api = window.electronAPI
    if (!api) return
    const saved = (await api.data.load(DATA_KEY)) as
      | { root?: string; rootName?: string; recentRoots?: RecentRoot[] }
      | null
    if (saved?.recentRoots?.length || saved?.root) {
      set({
        recentRoots: saved.recentRoots ?? [],
        root: saved.root ?? '',
        rootName: saved.rootName ?? '',
      })
      // 恢复上次项目根时自动加载根列表（树懒加载首层）
      if (saved.root) void get().loadDir('')
    }
  },

  pickRootAndSet: async () => {
    const api = explorerAPI()
    if (!api) return
    const r = await api.pickRoot()
    if (r.success && !r.canceled && r.root && r.name) get().setRoot(r.root, r.name)
  },

  setRoot: (path, name) => {
    const recents = [
      { path, name },
      ...get().recentRoots.filter((r) => r.path !== path),
    ].slice(0, MAX_RECENTS)
    set({
      root: path,
      rootName: name,
      recentRoots: recents,
      expanded: {},
      children: {},
      tabs: [],
      activeTabId: null,
    })
    void window.electronAPI?.data.save(DATA_KEY, {
      root: path,
      rootName: name,
      recentRoots: recents,
    })
    void get().loadDir('')
    // 联动 AI 助手工作目录（左侧 → 设置页同一 store，双向一致）
    syncAssistantWorkdir(path)
  },

  togglePanel: () => set((s) => ({ panelVisible: !s.panelVisible })),

  toggleDir: (rel) => {
    const expanded = { ...get().expanded, [rel]: !get().expanded[rel] }
    set({ expanded })
    if (expanded[rel] && !get().children[rel]) void get().loadDir(rel)
  },

  loadDir: async (rel) => {
    const { root, loadingDirs: busy } = get()
    const api = explorerAPI()
    if (!root || !api || busy[rel]) return
    set({ loadingDirs: { ...get().loadingDirs, [rel]: true } })
    const r = await api.list(root, rel)
    const children = { ...get().children }
    if (r.success && r.entries) {
      children[rel] = r.entries
    } else {
      children[rel] = []
    }
    const loadingDirs = { ...get().loadingDirs }
    delete loadingDirs[rel]
    set({ children, loadingDirs })
  },

  refreshDir: async (rel) => {
    await get().loadDir(rel)
  },

  openFile: async (rel) => {
    const { root, tabs } = get()
    const api = explorerAPI()
    if (!root || !api) return
    const existing = tabs.find((t) => t.id === rel)
    if (existing) {
      set({ activeTabId: rel })
      return
    }
    const ext = extOf(rel)
    if (isImageExt(ext)) {
      const r = await api.readBinary(root, rel)
      if (!r.success || !r.base64) {
        window.alert(`打开失败：${r.error ?? '读取失败'}`)
        return
      }
      const tab: ExplorerTab = {
        id: rel,
        kind: 'image',
        language: 'plaintext',
        content: '',
        original: '',
        base64: r.base64,
        mime: r.mime ?? 'application/octet-stream',
        dirty: false,
        size: r.size ?? 0,
        mtime: r.mtime ?? 0,
        locked: true,
      }
      set({ tabs: [...tabs, tab], activeTabId: rel })
      return
    }
    const r = await api.read(root, rel)
    if (!r.success) {
      window.alert(`打开失败：${r.error ?? '读取失败'}`)
      return
    }
    const tab: ExplorerTab = {
      id: rel,
      kind: r.kind ?? 'binary',
      language: monacoLanguageOf(rel),
      content: r.content ?? '',
      original: r.content ?? '',
      base64: '',
      mime: '',
      dirty: false,
      size: r.size ?? 0,
      mtime: r.mtime ?? 0,
      locked: false,
    }
    set({ tabs: [...get().tabs, tab], activeTabId: rel })
  },

  closeTab: (id) => {
    const { tabs, activeTabId } = get()
    const idx = tabs.findIndex((t) => t.id === id)
    if (idx < 0) return
    const next = tabs.filter((t) => t.id !== id)
    let nextActive = activeTabId
    if (activeTabId === id) {
      nextActive = next[Math.min(idx, next.length - 1)]?.id ?? null
    }
    set({ tabs: next, activeTabId: nextActive })
  },

  setActiveTab: (id) => set({ activeTabId: id }),

  updateContent: (id, content) => {
    set({
      tabs: get().tabs.map((t) =>
        t.id === id ? { ...t, content, dirty: content !== t.original } : t,
      ),
    })
  },

  saveTab: async (id) => {
    const { root, tabs } = get()
    const api = explorerAPI()
    const tab = tabs.find((t) => t.id === id)
    if (!root || !api || !tab) return { success: false, error: '标签不存在' }
    if (tab.kind !== 'text') return { success: false, error: '仅文本文件可保存' }
    const r = await api.write(root, tab.id, tab.content)
    if (!r.success) return { success: false, error: r.error }
    set({
      tabs: get().tabs.map((t) =>
        t.id === id ? { ...t, original: t.content, dirty: false, size: r.size ?? 0, mtime: r.mtime ?? 0 } : t,
      ),
    })
    return { success: true }
  },

  toggleLocked: (id) => {
    set({
      tabs: get().tabs.map((t) => (t.id === id ? { ...t, locked: !t.locked } : t)),
    })
  },

  createNode: async (parentRel, name, kind) => {
    const { root } = get()
    const api = explorerAPI()
    if (!root || !api) return { success: false, error: '未选择项目目录' }
    const rel = parentRel ? `${parentRel}/${name}` : name
    const r = kind === 'dir' ? await api.mkdir(root, rel) : await api.createFile(root, rel)
    if (!r.success) return { success: false, error: r.error }
    await get().refreshDir(parentRel)
    return { success: true }
  },

  renameNode: async (rel, newName) => {
    const { root } = get()
    const api = explorerAPI()
    if (!root || !api) return { success: false, error: '未选择项目目录' }
    const parent = parentOf(rel)
    const r = await api.rename(root, rel, newName)
    if (!r.success) return { success: false, error: r.error }
    // 旧路径的树缓存/展开态失效；重命名对象若是打开的 tab，同步更新其 id
    prunePrefix(get(), rel)
    const newRel = parent ? `${parent}/${newName}` : newName
    set({
      tabs: get().tabs.map((t) => (t.id === rel ? { ...t, id: newRel } : t)),
      activeTabId: get().activeTabId === rel ? newRel : get().activeTabId,
    })
    await get().refreshDir(parent ?? '')
    return { success: true }
  },

  deleteNode: async (rel) => {
    const { root, tabs, activeTabId } = get()
    const api = explorerAPI()
    if (!root || !api) return { success: false, error: '未选择项目目录' }
    const parent = parentOf(rel)
    const r = await api.delete(root, rel)
    if (!r.success) return { success: false, error: r.error }
    prunePrefix(get(), rel)
    const closedIds = new Set(tabs.filter((t) => t.id === rel || t.id.startsWith(`${rel}/`)).map((t) => t.id))
    const nextTabs = tabs.filter((t) => !closedIds.has(t.id))
    set({
      tabs: nextTabs,
      activeTabId: activeTabId !== null && closedIds.has(activeTabId) ? (nextTabs[nextTabs.length - 1]?.id ?? null) : activeTabId,
    })
    await get().refreshDir(parent ?? '')
    return { success: true }
  },
}))
