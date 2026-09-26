import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Compass, FilePlus2, Bot, Wrench, FileCode2 } from 'lucide-react'
import {
  useCrossStore,
  detectKind,
  type Carry,
  type CarryKind,
} from '../../store/crossStore'
import { useAppStore } from '../../store/appStore'
import { useToolboxStore } from '../../store/toolboxStore'
import { WORKSPACES } from '../workspaces'
import { TOOLBOX_MODULES } from '../constants'
import { defaultCarryTitle } from '../hooks/useSaveToVault'
import { electronAPI } from '../../workspaces/toolbox/utils/electron'
import type { CodeSnippet } from '../../types/toolbox'

/* ---------- 命令定义 ---------- */

interface CommandItem {
  id: string
  label: string
  /** 参与过滤的补充关键词（如模块 id、工作区 key） */
  keywords: string
  hint: string
  icon: ReactNode
  run: () => void
}

/* ---------- 捕获分发（自 CapturePalette 收编，作为命令无匹配时的 fallback） ---------- */

const KIND_LABEL: Partial<Record<CarryKind, string>> = {
  json: 'JSON',
  url: 'URL',
  timestamp: '时间戳',
}

/** 识别类型 → 工具箱模块映射（仅零误判类型；其余类型禁用「跑工具」） */
const KIND_TO_TOOL: Partial<Record<CarryKind, string>> = {
  json: 'json',
  url: 'url',
  timestamp: 'timestamp',
}

/** 存为代码片段：合并写入 SnippetsModule 的 'snippets' 存储（默认分类） */
async function saveAsSnippet(content: string, title: string): Promise<void> {
  let existing: CodeSnippet[] = []
  try {
    const data = (await electronAPI.loadData('snippets')) as
      | { categories?: { snippets?: CodeSnippet[] }[] }
      | null
    if (data && typeof data === 'object' && Array.isArray(data.categories)) {
      existing = data.categories.flatMap((c) => c.snippets ?? [])
    }
  } catch {
    // 读取失败视为空列表
  }
  const now = Date.now()
  const snippet: CodeSnippet = {
    id: now.toString(36) + Math.random().toString(36).slice(2),
    title,
    content,
    language: 'plaintext',
    category: 'default',
    tags: ['捕获'],
    createdAt: now,
    updatedAt: now,
  }
  await electronAPI.saveData('snippets', {
    categories: [{ id: 'default', name: '默认分类', snippets: [...existing, snippet] }],
  })
}

// 面板子组件：由 open 条件渲染挂载，状态随卸载自然清空，无需重置 effect
function CommandPanel({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  // toast 计时器随卸载清理（旧 CapturePalette 未清理，此处顺手补上）
  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const commands = useMemo<CommandItem[]>(() => {
    const wsCommands: CommandItem[] = WORKSPACES.map((w, i) => {
      const Icon = w.icon
      return {
        id: `ws:${w.key}`,
        label: w.label,
        keywords: w.key,
        hint: `工作区 · ⌘${i + 1}`,
        icon: <Icon size={15} />,
        run: () => {
          useAppStore.getState().setActiveWorkspace(w.key)
          onClose()
        },
      }
    })
    const toolCommands: CommandItem[] = TOOLBOX_MODULES.map((m) => ({
      id: `tool:${m.id}`,
      label: m.name,
      keywords: m.id,
      hint: '开发工具',
      icon: <span className="command-item-emoji">{m.icon}</span>,
      // 命令直达工具：直接激活模块，不走剪贴板（区别于捕获分发里的「跑工具」）
      run: () => {
        useToolboxStore.getState().setActiveModule(m.id)
        useAppStore.getState().setActiveWorkspace('toolbox')
        onClose()
      },
    }))
    return [...wsCommands, ...toolCommands]
  }, [onClose])

  const q = query.trim().toLowerCase()
  const filtered = useMemo(
    () =>
      q
        ? commands.filter(
            (c) => c.label.toLowerCase().includes(q) || c.keywords.toLowerCase().includes(q),
          )
        : commands,
    [commands, q],
  )

  // 捕获 fallback：输入非空且无任何命令匹配 → 按内容分发到工作区
  const captureMode = q.length > 0 && filtered.length === 0

  const kind = detectKind(query)
  const toolId = KIND_TO_TOOL[kind]
  const title = defaultCarryTitle('捕获')

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2000)
  }

  const carryTo = (): boolean => {
    if (!query.trim()) {
      showToast('内容为空')
      return false
    }
    const carry: Carry = {
      id: `carry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: 'capture',
      kind,
      title,
      content: query,
      createdAt: Date.now(),
    }
    useCrossStore.getState().setCarry(carry)
    return true
  }

  const goNote = () => {
    if (!carryTo()) return
    useAppStore.getState().setActiveWorkspace('knowledge')
    onClose()
  }

  const goAgent = () => {
    if (!carryTo()) return
    useAppStore.getState().setActiveWorkspace('assistant')
    onClose()
  }

  const goTool = () => {
    if (!toolId) return
    void navigator.clipboard.writeText(query).then(() => {
      useToolboxStore.getState().setActiveModule(toolId)
      useAppStore.getState().setActiveWorkspace('toolbox')
      onClose()
    })
  }

  const goSnippet = async () => {
    if (!query.trim()) return showToast('内容为空')
    await saveAsSnippet(query, title)
    showToast('已存为代码片段')
    onClose()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex((i) =>
        filtered.length ? (Math.min(i, filtered.length - 1) + 1) % filtered.length : 0,
      )
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) =>
        filtered.length
          ? (Math.min(i, filtered.length - 1) + filtered.length - 1) % filtered.length
          : 0,
      )
      return
    }
    // Enter（无 Shift）执行选中命令；Shift+Enter 换行
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      const item = filtered[Math.min(activeIndex, filtered.length - 1)]
      item?.run()
    }
  }

  return (
    <div className="capture-overlay" onClick={onClose}>
      <div className="capture-panel" onClick={(e) => e.stopPropagation()}>
        <div className="capture-input-row">
          <Compass size={15} className="capture-icon" />
          <textarea
            className="capture-input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="跳转工作区 / 直达工具…；无匹配时按内容分发（Esc 关闭）"
            rows={2}
            autoFocus
          />
        </div>

        {captureMode ? (
          <div className="capture-actions">
            <span className={`capture-kind kind-${kind}`}>{KIND_LABEL[kind] ?? '文本'}</span>
            <button className="capture-action" onClick={goNote}>
              <FilePlus2 size={14} /> 存为笔记
            </button>
            <button className="capture-action" onClick={goAgent}>
              <Bot size={14} /> 喂给助手
            </button>
            <button
              className="capture-action"
              onClick={goTool}
              disabled={!toolId}
              title={toolId ? '已复制，去对应工具粘贴' : '未识别出可处理的类型'}
            >
              <Wrench size={14} /> 跑工具
            </button>
            <button className="capture-action" onClick={() => void goSnippet()}>
              <FileCode2 size={14} /> 存为片段
            </button>
          </div>
        ) : (
          <ul className="command-list" role="listbox" aria-label="命令列表">
            {filtered.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected={i === Math.min(activeIndex, filtered.length - 1)}
                  className={`command-item${i === Math.min(activeIndex, filtered.length - 1) ? ' active' : ''}`}
                  onClick={c.run}
                  onMouseEnter={() => setActiveIndex(i)}
                >
                  <span className="command-item-icon">{c.icon}</span>
                  <span className="command-item-label">{c.label}</span>
                  <span className="command-item-hint">{c.hint}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {toast && <div className="capture-toast">{toast}</div>}
      </div>
    </div>
  )
}

/* 全局命令面板（设计附录 D P2：骨架的「命令总线」）：
 * Cmd/Ctrl+Shift+K 唤起、Esc 关闭 —— 开关统一收口在 App 的 useGlobalShortcuts。
 * 动作源 = 工作区跳转 + 工具直达；输入无匹配时降级为捕获分发（自 CapturePalette 收编）。
 * 后续可逐步扩充：技能应用、笔记搜索等。常驻于 App 根部。
 */
interface CommandPaletteProps {
  open: boolean
  onClose: () => void
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  return open ? <CommandPanel onClose={onClose} /> : null
}
