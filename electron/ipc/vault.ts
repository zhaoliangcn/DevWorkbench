import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import path from 'node:path'
import fs from 'node:fs'
import { setVaultPath } from '../api-server.js'

let vaultPath: string | null = null

const CONFIG_PATH = path.join(app.getPath('userData'), 'vault-config.json')

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
    return { path: vaultPath, name: path.basename(vaultPath) }
  })
}

export { ensureVault, resolveSafe, getVaultPath, registerVaultIpc }
