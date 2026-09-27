import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import chokidar from 'chokidar'
import type { FSWatcher } from 'chokidar'
import { setVaultPath } from '../api-server.js'

let vaultPath: string | null = null

const CONFIG_PATH = path.join(app.getPath('userData'), 'vault-config.json')

/* ---------- vault 监听（附录 E E.3.6） ---------- */

let watcher: FSWatcher | null = null

/** 自写文件时间戳：静默窗口内的事件是自己的落盘回声，不推送（防回环） */
const recentWrites = new Map<string, number>()
const WRITE_ECHO_WINDOW_MS = 1500

/** 落盘时打标：file.ts 的写入/移动/删除操作都要调用 */
function markWrite(relativePath: string) {
  recentWrites.set(relativePath, Date.now())
}

function isOwnEcho(relativePath: string): boolean {
  const ts = recentWrites.get(relativePath)
  if (ts === undefined) return false
  if (Date.now() - ts > WRITE_ECHO_WINDOW_MS) {
    recentWrites.delete(relativePath)
    return false
  }
  return true
}

function broadcastChanged(relPath: string, kind: 'add' | 'change' | 'unlink') {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('vault:changed', { relPath, kind })
  }
}

function relayChange(full: string, kind: 'add' | 'change' | 'unlink') {
  if (!vaultPath) return
  const relPath = path.relative(vaultPath, full).split(path.sep).join('/')
  // trash/ 是自己的回收站、attachments/ 二进制附件由 dataURL 缓存管理，都不推
  if (relPath.startsWith('trash/') || relPath.startsWith('attachments/')) return
  if (kind !== 'unlink' && isOwnEcho(relPath)) return
  if (kind === 'unlink') recentWrites.delete(relPath)
  broadcastChanged(relPath, kind)
}

function startVaultWatcher() {
  void watcher?.close()
  watcher = null
  if (!vaultPath) return

  watcher = chokidar.watch(vaultPath, {
    ignoreInitial: true,
    ignorePermissionErrors: true,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
  })

  watcher
    .on('add', (full) => relayChange(full, 'add'))
    .on('change', (full) => relayChange(full, 'change'))
    .on('unlink', (full) => relayChange(full, 'unlink'))
    .on('error', () => {
      // 监听失败静默降级：仍可重开 vault 全量加载
    })
}

/* ---------- vault 目录 ---------- */

function loadVaultConfig(): string | null {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const data = fs.readFileSync(CONFIG_PATH, 'utf-8')
      const config = JSON.parse(data)
      if (config.vaultPath && fs.existsSync(config.vaultPath)) {
        return config.vaultPath
      }
    }
  } catch {
    // ignore
  }
  return null
}

function saveVaultConfig(p: string) {
  try {
    fs.writeFileSync(CONFIG_PATH, JSON.stringify({ vaultPath: p }), 'utf-8')
  } catch {
    // ignore
  }
}

async function ensureVault(): Promise<string> {
  const saved = loadVaultConfig()
  if (saved) {
    vaultPath = saved
    return saved
  }

  const dialogOpts = {
    title: '选择知识库文件夹',
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
    message: '请选择一个文件夹作为知识库（Vault），所有笔记将保存为 .md 文件',
  }
  const parent = BrowserWindow.getAllWindows()[0]
  const result = parent
    ? await dialog.showOpenDialog(parent, dialogOpts)
    : await dialog.showOpenDialog(dialogOpts)

  if (result.canceled || result.filePaths.length === 0) {
    const defaultPath = path.join(app.getPath('documents'), 'DevWorkbench')
    if (!fs.existsSync(defaultPath)) {
      fs.mkdirSync(defaultPath, { recursive: true })
    }
    vaultPath = defaultPath
    saveVaultConfig(defaultPath)
    return defaultPath
  }

  vaultPath = result.filePaths[0]
  saveVaultConfig(vaultPath)
  return vaultPath
}

function resolveSafe(relativePath: string): string {
  const resolved = path.resolve(vaultPath!, relativePath)
  if (!resolved.startsWith(vaultPath!)) {
    throw new Error('路径越界')
  }
  return resolved
}

function getVaultPath(): string | null {
  return vaultPath
}

function registerVaultIpc() {
  ipcMain.handle('vault:getPath', () => vaultPath)
  ipcMain.handle('vault:getName', () => (vaultPath ? path.basename(vaultPath) : null))
  ipcMain.handle('vault:select', async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择知识库文件夹',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) return null
    vaultPath = result.filePaths[0]
    saveVaultConfig(vaultPath)
    setVaultPath(vaultPath)
    startVaultWatcher() // 换 vault 重建监听
    return { path: vaultPath, name: path.basename(vaultPath) }
  })
}

export { ensureVault, resolveSafe, getVaultPath, registerVaultIpc, markWrite, startVaultWatcher }
