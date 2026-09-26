import { Suspense, useState } from 'react'
import type { WorkspaceDef } from '../workspaces'

/** lazy chunk 加载中的骨架屏（复用 workspace-placeholder 样式） */
export function WorkspaceLoading({ label }: { label: string }) {
  return (
    <div className="workspace-placeholder" role="status">
      <h2>{label}</h2>
      <p>正在加载…</p>
    </div>
  )
}

/**
 * 延迟挂载包装（附录 D P2 / D.5）：lazy 与 Activity 保活组合时，hidden 工作区
 * 首挂也会渲染子树，四个 chunk 会在首帧同时触发加载。此包装保证工作区仅在
 * 首次激活后才挂载（开始拉取 chunk）；挂载后交由外层 Activity 保活，不再卸载。
 *
 * 置于 Activity 内侧：hidden 期间不渲染激活分支，首次转 visible 时
 * `active` 变真，在渲染期完成「已激活」标记（React 官方「prop 变化时调整
 * state」模式，避免 effect 内 setState）—— chunk 加载由「首次激活」触发。
 */
export function DeferredWorkspace({ def, active }: { def: WorkspaceDef; active: boolean }) {
  const [mounted, setMounted] = useState(active)

  // 激活即永久挂载：渲染期条件性调整 state（不得移入 effect，会触发级联渲染）
  if (active && !mounted) setMounted(true)

  if (!mounted) {
    return <div className="workspace-slot" aria-hidden="true" />
  }

  const Workspace = def.component
  return (
    <Suspense fallback={<WorkspaceLoading label={def.label} />}>
      <Workspace />
    </Suspense>
  )
}
