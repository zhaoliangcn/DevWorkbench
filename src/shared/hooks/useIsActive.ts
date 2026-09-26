import { useAppStore, type Workspace } from '../../store/appStore'

/**
 * 当前工作区是否激活（设计附录 D P1）。
 * Activity 保活下，隐藏工作区的 effects 会被 React 自动卸载（订阅自然暂停）；
 * 对「不能靠 effect 卸载表达」的资源 —— 如需要保留的 SSH 连接、卸载 cleanup 里的
 * 释放逻辑 —— 用此 hook 派生开关做精细控制。
 */
export function useIsActive(key: Workspace): boolean {
  return useAppStore((s) => s.activeWorkspace === key)
}
