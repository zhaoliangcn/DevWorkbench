import { useCallback } from 'react'
import {
  useCrossStore,
  detectKind,
  type Carry,
  type CarryKind,
  type CarrySource,
} from '../../store/crossStore'
import { useAppStore } from '../../store/appStore'

export interface SaveToVaultInput {
  content: string
  title?: string
  kind?: CarryKind
  source?: CarrySource
  meta?: Record<string, unknown>
}

/** 携带物标题默认值：`{前缀} YYYY-MM-DD HH:mm`（与知识库 generateNoteId 同风格，不引入额外依赖） */
export function defaultCarryTitle(prefix: string): string {
  const now = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${prefix} ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`
}

/**
 * 将内容装入跨工作区总线（crossStore.carry）并跳转知识库工作区，
 * 由知识库侧的 CarryLanding 浮层完成落地确认（标题 / 目标文件夹 / 标签）。
 * 返回 false 表示内容为空未装载。
 */
export function useSaveToVault() {
  return useCallback((input: SaveToVaultInput): boolean => {
    const content = input.content
    if (!content.trim()) return false
    const carry: Carry = {
      id: `carry_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      source: input.source ?? 'toolbox',
      kind: input.kind ?? detectKind(content),
      title: input.title ?? defaultCarryTitle('捕获'),
      content,
      meta: input.meta,
      createdAt: Date.now(),
    }
    useCrossStore.getState().setCarry(carry)
    useAppStore.getState().setActiveWorkspace('knowledge')
    return true
  }, [])
}
