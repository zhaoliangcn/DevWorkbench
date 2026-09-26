import { useEffect, useRef, useState } from 'react'
import { Clipboard, FilePlus2, Bot, Wrench, FileCode2 } from 'lucide-react'
import {
  useCrossStore,
  detectKind,
  type Carry,
  type CarryKind,
} from '../../store/crossStore'
import { useAppStore } from '../../store/appStore'
import { useToolboxStore } from '../../store/toolboxStore'
import { defaultCarryTitle } from '../../shared/hooks/useSaveToVault'
import { electronAPI } from '../../workspaces/toolbox/utils/electron'
import type { CodeSnippet } from '../../types/toolbox'

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
function CapturePanel({ onClose }: { onClose: () => void }) {
  const [text, setText] = useState('')
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number | undefined>(undefined)

  const kind = detectKind(text)
  const toolId = KIND_TO_TOOL[kind]
  const title = defaultCarryTitle('捕获')

  const showToast = (msg: string) => {
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(''), 2000)
  }

  const carryTo = (): boolean => {
    if (!text.trim()) {
      showToast('内容为空')
      return false
    }
    const carry: Carry = {
      id: `carry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: 'capture',
      kind,
      title,
      content: text,
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
    void navigator.clipboard.writeText(text).then(() => {
      useToolboxStore.getState().setActiveModule(toolId)
      useAppStore.getState().setActiveWorkspace('toolbox')
      onClose()
    })
  }

  const goSnippet = async () => {
    if (!text.trim()) return showToast('内容为空')
    await saveAsSnippet(text, title)
    showToast('已存为代码片段')
    onClose()
  }

  return (
    <div className="capture-overlay" onClick={onClose}>
      <div className="capture-panel" onClick={(e) => e.stopPropagation()}>
        <div className="capture-input-row">
          <Clipboard size={15} className="capture-icon" />
          <textarea
            className="capture-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="任意内容：JSON / URL / 时间戳 / 文本…（Esc 关闭）"
            rows={4}
            autoFocus
          />
        </div>
        <div className="capture-actions">
          <span className={`capture-kind kind-${kind}`}>{KIND_LABEL[kind] ?? '文本'}</span>
          <button className="capture-action" onClick={goNote} disabled={!text.trim()}>
            <FilePlus2 size={14} /> 存为笔记
          </button>
          <button className="capture-action" onClick={goAgent} disabled={!text.trim()}>
            <Bot size={14} /> 喂给助手
          </button>
          <button
            className="capture-action"
            onClick={goTool}
            disabled={!toolId || !text.trim()}
            title={toolId ? '已复制，去对应工具粘贴' : '未识别出可处理的类型'}
          >
            <Wrench size={14} /> 跑工具
          </button>
          <button
            className="capture-action"
            onClick={() => void goSnippet()}
            disabled={!text.trim()}
          >
            <FileCode2 size={14} /> 存为片段
          </button>
        </div>
        {toast && <div className="capture-toast">{toast}</div>}
      </div>
    </div>
  )
}

// 全局捕获中心（切片 C / 设计文档附录 C.4）：Cmd/Ctrl+Shift+K 唤起，
// 任意输入按去向分发到三个工作区。常驻挂载于 App 根部。
export function CapturePalette() {
  const [open, setOpen] = useState(false)

  // Cmd/Ctrl+Shift+K 开关；Esc 关闭（面板内按键冒泡到 window）
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return open ? <CapturePanel onClose={() => setOpen(false)} /> : null
}
