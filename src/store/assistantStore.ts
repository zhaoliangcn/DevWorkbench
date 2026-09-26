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

/**
 * 三段式权限清单（切片 E，设计 C.3 呼应 dsh 借鉴）：
 * - auto-allow：清单外且低危的工具，由 dev-assistant-ts 内置策略自动放行（推导展示，不存储）
 * - needsApproval：每次执行前强制经审批墙确认
 * - disabled：启动时不注册，LLM 不可见（改动需重启助手）
 */
export interface AssistantPolicy {
  needsApproval: string[]
  disabled: string[]
}

export const DEFAULT_ASSISTANT_POLICY: AssistantPolicy = {
  needsApproval: ['write_file', 'edit_file'],
  disabled: ['exec_command', 'run_hook'],
}

/** 技能预设（切片 H）：名称 + prompt 模板，持久化到 assistantStore；tools 为可选工具白名单（H.2 进阶） */
export interface AssistantSkill {
  id: string
  name: string
  prompt: string
  tools?: string[]
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

  /** 审批墙开关（切片 D）：开启后高危工具调用经 assistant:events 推送审批请求 */
  approvalEnabled: boolean
  setApprovalEnabled: (v: boolean) => void

  /** 三段式权限清单（切片 E）：随助手启动传入主进程生效 */
  policy: AssistantPolicy
  setPolicy: (p: AssistantPolicy) => void

  /** 技能预设（切片 H，C.8「组合工具集+prompt 存预设」MVP）：可复用的 prompt 模板 */
  skills: AssistantSkill[]
  addSkill: (name: string, prompt: string, tools?: string[]) => void
  removeSkill: (id: string) => void
  /** 编辑技能（H.3）：局部更新名称/prompt/工具绑定 */
  updateSkill: (id: string, patch: Partial<Pick<AssistantSkill, 'name' | 'prompt' | 'tools'>>) => void

  /** 当前激活的技能模式（H.2）：name 供横幅展示，tools 供启动后重放工具过滤器 */
  activeSkill: { name: string; tools: string[] | null } | null
  setActiveSkill: (s: { name: string; tools: string[] | null } | null) => void

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

      approvalEnabled: false,
      setApprovalEnabled: (approvalEnabled) => set({ approvalEnabled }),

      policy: DEFAULT_ASSISTANT_POLICY,
      setPolicy: (policy) => set({ policy }),

      skills: [],
      addSkill: (name, prompt, tools) =>
        set({
          skills: [
            ...get().skills,
            {
              id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
              name,
              prompt,
              ...(tools && tools.length > 0 ? { tools } : {}),
            },
          ],
        }),
      removeSkill: (id) => set({ skills: get().skills.filter((s) => s.id !== id) }),
      updateSkill: (id, patch) =>
        set({ skills: get().skills.map((s) => (s.id === id ? { ...s, ...patch } : s)) }),

      activeSkill: null,
      setActiveSkill: (activeSkill) => set({ activeSkill }),

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
        policy: state.policy,
        skills: state.skills,
      }),
      onRehydrateStorage: () => (state) => {
        state?.setHydrated(true)
      },
    },
  ),
)
