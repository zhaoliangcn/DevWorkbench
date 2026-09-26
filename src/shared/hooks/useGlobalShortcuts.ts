import { useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { WORKSPACES } from '../workspaces'

interface GlobalShortcutHandlers {
  /** Cmd/Ctrl+Shift+K：命令面板开关 */
  onTogglePalette: () => void
  /** Esc：关闭命令面板（未打开时 no-op） */
  onClosePalette: () => void
}

/**
 * 全局快捷键统一收口（设计附录 D P1）：挂在 App 根部，单一清理点。
 * - Cmd/Ctrl+1..9：按注册表 order 切换工作区
 * - Cmd/Ctrl+Shift+K：全局命令面板（自 CapturePalette 内部实现收编，P2 演进为 CommandPalette）
 * - Esc：关闭命令面板
 */
export function useGlobalShortcuts({ onTogglePalette, onClosePalette }: GlobalShortcutHandlers) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey
      if (mod && e.shiftKey && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onTogglePalette()
        return
      }
      if (mod && !e.shiftKey && !e.altKey && /^[1-9]$/.test(e.key)) {
        const target = WORKSPACES[Number(e.key) - 1]
        if (target) {
          e.preventDefault()
          useAppStore.getState().setActiveWorkspace(target.key)
        }
        return
      }
      if (e.key === 'Escape') onClosePalette()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onTogglePalette, onClosePalette])
}
