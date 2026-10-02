// explorer IPC 注册冒烟验证（electron 环境运行）：
//   npx electron scripts/explorer-ipc-smoke.mjs
// 覆盖：registerExplorerIpc 注册 10 个通道、dist 产物可加载、核心导出存在
import { app, ipcMain } from 'electron'
import * as explorer from '../dist-electron/ipc/explorer.js'

app.whenReady().then(() => {
  let pass = 0
  let fail = 0
  const check = (name, cond, detail = '') => {
    if (cond) {
      pass++
      console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`)
    } else {
      fail++
      console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
    }
  }

  const channels = [
    'explorer:pickRoot',
    'explorer:list',
    'explorer:read',
    'explorer:readBinary',
    'explorer:write',
    'explorer:stat',
    'explorer:mkdir',
    'explorer:createFile',
    'explorer:rename',
    'explorer:delete',
  ]

  // 拦截 ipcMain.handle 计数（不依赖内部 _handlers 结构）
  const orig = ipcMain.handle.bind(ipcMain)
  const registered = []
  ipcMain.handle = (ch, fn) => {
    registered.push(ch)
    return orig(ch, fn)
  }

  explorer.registerExplorerIpc()

  const missing = channels.filter((c) => !registered.includes(c))
  check('注册全部 10 个 explorer 通道', registered.length === 10 && missing.length === 0, missing.length ? `缺: ${missing.join(',')}` : registered.join(','))
  check('核心导出完整', ['resolveSafeEx', 'listEntries', 'readEntry', 'writeEntry', 'renameEntry', 'deleteEntry'].every((k) => typeof explorer[k] === 'function'))

  console.log(`\n结果: ${pass} PASS, ${fail} FAIL`)
  app.exit(fail > 0 ? 1 : 0)
})
