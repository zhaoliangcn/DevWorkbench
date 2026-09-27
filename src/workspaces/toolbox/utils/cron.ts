// 附录 F F.4b：Cron 纯函数规范实现下沉至 electron/ipc/cron-core.ts
// （主进程 scheduler 与渲染层共用单一事实源；受 tsconfig.electron.json
// rootDir 约束，规范实现置于 electron 侧，此处 re-export 保持原引用路径）
export { parseCron, nextRun, getNextRuns, replaceField, ruleMatches } from '../../../../electron/ipc/cron-core'
export type { CronRule } from '../../../../electron/ipc/cron-core'
