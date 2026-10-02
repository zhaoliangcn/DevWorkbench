import { useEffect } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { useExplorerStore } from '../../../store/explorerStore'
import { FileTree } from './FileTree'

// 文件浏览面板：项目根选择（对话框 + 最近列表）+ 目录树 + 刷新。
// init 仅在首次挂载执行（Activity 保活下工作区只挂载一次，状态跨切换保留）。

export function ExplorerPanel() {
  const root = useExplorerStore((s) => s.root)
  const rootName = useExplorerStore((s) => s.rootName)
  const recentRoots = useExplorerStore((s) => s.recentRoots)
  const init = useExplorerStore((s) => s.init)
  const pickRootAndSet = useExplorerStore((s) => s.pickRootAndSet)
  const setRoot = useExplorerStore((s) => s.setRoot)
  const refreshDir = useExplorerStore((s) => s.refreshDir)

  useEffect(() => {
    void init()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="explorer-panel">
      <div className="explorer-toolbar">
        <select
          className="explorer-root-select"
          value={root}
          onChange={(e) => {
            const hit = recentRoots.find((r) => r.path === e.target.value)
            if (hit) setRoot(hit.path, hit.name)
          }}
          title={root || '选择项目根目录'}
        >
          {root ? (
            <option value={root}>{rootName}</option>
          ) : (
            <option value="">未选择项目</option>
          )}
          {recentRoots
            .filter((r) => r.path !== root)
            .map((r) => (
              <option key={r.path} value={r.path}>
                {r.name}
              </option>
            ))}
        </select>
        <button className="explorer-tool-btn" title="打开文件夹…" onClick={() => void pickRootAndSet()}>
          <FolderOpen size={14} />
        </button>
        <button
          className="explorer-tool-btn"
          title="刷新当前目录"
          onClick={() => {
            const expanded = useExplorerStore.getState().expanded
            void refreshDir('')
            // 已展开目录全部重拉，外部变更同步进来
            for (const rel of Object.keys(expanded)) {
              if (expanded[rel]) void refreshDir(rel)
            }
          }}
        >
          <RefreshCw size={14} />
        </button>
      </div>
      <FileTree />
    </div>
  )
}
