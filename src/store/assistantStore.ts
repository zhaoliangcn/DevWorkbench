import { create } from 'zustand'
import { persist } from 'zustand/middleware'

/**
 * AI 助手状态（Phase 6）：模型配置持久化 + 运行状态 + 聊天消息流。
 *
 * 模型配置经 data IPC 持久化（dev-assistant-models 键），主进程 AssistantModule
 * 按配置启动/热替换（assistant:start / assistant:setModels）。
 */

export interface AssistantChatMessage {
  id: number
  role: 'user' | 'assistant' | 'tool' | 'status' | 'error'
  content: string
  /** 工具名（role=tool） */
  toolName?: string
}

interface AssistantState {
  // 模型配置（持久化）
  models: AssistantModelConfig[]
  activeModel: string
  addModel: (m: AssistantModelConfig) => void
  updateModel: (m: AssistantModelConfig) => void
  removeModel: (name: string) => void
  setActiveModel: (name: string) => void

  // 运行状态
  status: AssistantStatus | null
  setStatus: (s: AssistantStatus | null) => void
  running: boolean
  setRunning: (r: boolean) => void
  error: string
  setError: (e: string) => void

  // 聊天
  messages: AssistantChatMessage[]
  pushMessage: (m: Omit<AssistantChatMessage, 'id'>) => void
  appendToLast: (content: string) => void
  clearMessages: () => void

  // 持久化
  hydrated: boolean
  setHydrated: (v: boolean) => void
}

const DEFAULT_MODELS: AssistantModelConfig[] = [
  {
    name: 'ollama',
    provider: 'ollama',
    apiUrl: 'http://localhost:11434/v1',
    apiKey: '',
    model: 'qwen2.5:7b',
    temperature: 0.7,
    maxOutputTokens: 2048,
  },
  {
    name: 'openai',
    provider: 'openai',
    apiUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini',
    temperature: 0.7,
    maxOutputTokens: 2048,
  },
]

let msgSeq = 1

export const useAssistantStore = create<AssistantState>()(
  persist(
    (set, get) => ({
      models: DEFAULT_MODELS,
      activeModel: 'ollama',
      addModel: (m) => set({ models: [...get().models.filter((x) => x.name !== m.name), m] }),
      updateModel: (m) =>
        set({ models: get().models.map((x) => (x.name === m.name ? m : x)) }),
      removeModel: (name) =>
        set({
          models: get().models.filter((x) => x.name !== name),
          activeModel: get().activeModel === name ? (get().models.find((x) => x.name !== name)?.name ?? '') : get().activeModel,
        }),
      setActiveModel: (name) => set({ activeModel: name }),

      status: null,
      setStatus: (status) => set({ status }),
      running: false,
      setRunning: (running) => set({ running }),
      error: '',
      setError: (error) => set({ error }),

      messages: [],
      pushMessage: (m) =>
        set({ messages: [...get().messages, { ...m, id: msgSeq++ }] }),
      appendToLast: (content) => {
        const messages = [...get().messages]
        const last = messages[messages.length - 1]
        if (last && last.role === 'assistant') {
          last.content += content
        } else {
          messages.push({ id: msgSeq++, role: 'assistant', content })
        }
        set({ messages })
      },
      clearMessages: () => set({ messages: [] }),

      hydrated: false,
      setHydrated: (hydrated) => set({ hydrated }),
    }),
    {
      name: 'devworkbench-assistant',
      partialize: (state) => ({
        models: state.models,
        activeModel: state.activeModel,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true)
      },
    },
  ),
)
