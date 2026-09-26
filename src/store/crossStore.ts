import { create } from 'zustand'

/**
 * 跨工作区共享总线（设计文档附录 C / 切片 A）。
 *
 * 只存「在途的、跨域的」瞬态数据，不持久化（避免与各域自己的 store 冲突）：
 * - carry：当前携带物（单槽，新带覆盖旧的），由源工作区装入，目标工作区落地确认后清槽
 * - recentLinks：联动历史（保留最近 20 条），供后续「最近联动」入口使用
 */

export type CarrySource = 'toolbox' | 'assistant' | 'knowledge' | 'capture'

export type CarryKind =
  | 'text'
  | 'json'
  | 'url'
  | 'timestamp'
  | 'http-response'
  | 'ssh-log'
  | 'db-result'
  | 'image'
  | 'note-ref'

export interface Carry {
  id: string
  source: CarrySource
  kind: CarryKind
  title: string
  content: string
  meta?: Record<string, unknown>
  createdAt: number
}

interface CrossState {
  carry: Carry | null
  setCarry: (c: Carry | null) => void
  recentLinks: Array<{ from: CarrySource; to: CarrySource; ts: number }>
  pushLink: (from: CarrySource, to: CarrySource) => void
}

/** 轻量内容识别（切片 B 抽取工具纯函数后由其接管；误判率优先趋零，base64 不自动识别） */
export function detectKind(text: string): CarryKind {
  const t = text.trim()
  if (!t) return 'text'
  if (/^[{[]/.test(t)) {
    try {
      JSON.parse(t)
      return 'json'
    } catch {
      // 非 JSON，继续回落
    }
  }
  if (/^https?:\/\/\S+$/i.test(t)) return 'url'
  if (/^\d{10}$|^\d{13}$/.test(t)) return 'timestamp'
  return 'text'
}

export const useCrossStore = create<CrossState>()((set, get) => ({
  carry: null,
  setCarry: (carry) => set({ carry }),

  recentLinks: [],
  pushLink: (from, to) =>
    set({
      recentLinks: [...get().recentLinks.slice(-19), { from, to, ts: Date.now() }],
    }),
}))
