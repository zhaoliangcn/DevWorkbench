import { useRef, useState } from 'react'
import { NotebookPen } from 'lucide-react'
import { useSaveToVault, defaultCarryTitle } from '../../shared/hooks/useSaveToVault'

interface SaveToVaultButtonProps {
  moduleName: string
  /** 捕获范围根节点（module-content 容器） */
  containerRef: React.RefObject<HTMLDivElement | null>
}

/**
 * 方案 B（零侵入）启发式捕获：优先取焦点中的 textarea，否则从容器内
 * 倒序找第一个非空的 textarea/pre/code 作为当前工具输出。
 * 高价值工具（JSON/HTTP/DB）后续升级为方案 A：工具主动上抛输出。
 */
function captureOutput(container: HTMLElement | null): string {
  if (!container) return ''
  const active = document.activeElement
  if (active instanceof HTMLTextAreaElement && container.contains(active)) {
    return active.value
  }
  const regions = container.querySelectorAll('textarea, pre, code')
  for (let i = regions.length - 1; i >= 0; i--) {
    const el = regions[i]
    const text = el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '')
    if (text.trim()) return text
  }
  return ''
}

// 工具箱容器层通用按钮：捕获当前工具输出 → 装入跨工作区总线 → 跳转知识库落地
export function SaveToVaultButton({ moduleName, containerRef }: SaveToVaultButtonProps) {
  const saveToVault = useSaveToVault()
  const [hint, setHint] = useState('')
  const hintTimer = useRef<number | undefined>(undefined)

  const showHint = (text: string) => {
    setHint(text)
    window.clearTimeout(hintTimer.current)
    hintTimer.current = window.setTimeout(() => setHint(''), 2000)
  }

  const handleClick = () => {
    const content = captureOutput(containerRef.current)
    const ok = saveToVault({
      content,
      title: defaultCarryTitle(moduleName),
      source: 'toolbox',
    })
    if (!ok) showHint(content ? '内容为空' : '未捕获到输出内容')
  }

  return (
    <div className="save-to-vault-wrap">
      {hint && <span className="save-to-vault-hint">{hint}</span>}
      <button
        className="save-to-vault-btn"
        onClick={handleClick}
        title="捕获当前工具输出并存入知识库"
      >
        <NotebookPen size={14} />
        <span>存入知识库</span>
      </button>
    </div>
  )
}
