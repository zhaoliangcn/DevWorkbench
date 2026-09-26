import { lazy } from 'react'
import type { ComponentType } from 'react'
import { BookOpen, Bot, Wrench, Settings } from 'lucide-react'
import type { Workspace } from '../store/appStore'

/** 布局模式（附录 D P3 占位）：split 预期用于知识库+助手并排（附录 C 链路的自然延伸） */
export type WorkspaceLayout = 'single' | 'split'

/** 工作区定义（设计附录 D P0）：工作台骨架的单一事实源 */
export interface WorkspaceDef {
  key: Workspace
  label: string
  icon: ComponentType<{ size?: number }>
  /** P2 起为 React.lazy 组件：按工作区分包，重依赖（d3/xterm/marked）不进首屏 */
  component: ComponentType
  /** 展示排序，越小越靠前 */
  order: number
  /** 布局模式（P3 占位）：当前渲染恒为 single，split 待 workspace-body 分栏支持后启用 */
  preferredLayout?: WorkspaceLayout
}

/** 收口工作区定义；新增工作区只需在 WORKSPACES 里加一条记录（并在 appStore 扩展 key 类型）。
 * preferredLayout 缺省补 'single'，新工作区默认单栏、无需显式声明。 */
function defineWorkspace(def: WorkspaceDef): WorkspaceDef {
  return { preferredLayout: 'single', ...def }
}

export const WORKSPACES: WorkspaceDef[] = [
  defineWorkspace({
    key: 'knowledge',
    label: '知识库',
    icon: BookOpen,
    component: lazy(() =>
      import('../workspaces/knowledge/KnowledgeWorkspace').then((m) => ({ default: m.KnowledgeWorkspace })),
    ),
    order: 1,
  }),
  defineWorkspace({
    key: 'assistant',
    label: 'AI 助手',
    icon: Bot,
    component: lazy(() =>
      import('../workspaces/assistant/AssistantWorkspace').then((m) => ({ default: m.AssistantWorkspace })),
    ),
    order: 2,
  }),
  defineWorkspace({
    key: 'toolbox',
    label: '开发工具',
    icon: Wrench,
    component: lazy(() =>
      import('../workspaces/toolbox/ToolboxWorkspace').then((m) => ({ default: m.ToolboxWorkspace })),
    ),
    order: 3,
  }),
  defineWorkspace({
    key: 'settings',
    label: '设置',
    icon: Settings,
    component: lazy(() =>
      import('../workspaces/settings/SettingsWorkspace').then((m) => ({ default: m.SettingsWorkspace })),
    ),
    order: 4,
  }),
].sort((a, b) => a.order - b.order)
