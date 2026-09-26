import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadApiConfig } from './api-config.js'
import { startApiServer, stopApiServer, setVaultPath } from './api-server.js'
import { ensureVault, registerVaultIpc, getVaultPath } from './ipc/vault.js'
import { registerFileIpc } from './ipc/file.js'
import { registerDirIpc } from './ipc/dir.js'
import { registerToolboxIpc } from './ipc/index.js'
import { registerAssistantIpc, stopAssistant } from './ipc/assistant.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const isDev = process.env.NODE_ENV === 'development'

const preloadPath = path.resolve(__dirname, 'preload.js')

let mainWindow: BrowserWindow | null = null

function createWindow() {
  // 附录 D P3（窗口基础设施，占位未实施 —— 实施时再展开，勿提前改动运行时行为）：
  // 1) 窗口尺寸/位置持久化：启动时从 userData 读上次 bounds 恢复，close 事件保存；
  // 2) 自定义标题栏：titleBarStyle: 'hiddenInset' + 渲染层自绘拖拽区（top-nav 加 -webkit-app-region: drag）。
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DevWorkbench',
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173')
    mainWindow.webContents.openDevTools()
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

app.whenReady().then(async () => {
  await ensureVault()

  // 注册各命名空间的 IPC handler
  registerVaultIpc()
  registerFileIpc()
  registerDirIpc()
  // Phase 3: 工具箱（ssh/system/data/app）
  registerToolboxIpc()
  // Phase 6: AI 助手（assistant:* 命名空间）
  registerAssistantIpc()

  createWindow()

  // API Server（知识库对外 REST 接口）
  setVaultPath(getVaultPath()!)
  const apiConfig = loadApiConfig()
  if (apiConfig.enabled) {
    try {
      await startApiServer(apiConfig)
    } catch (err) {
      console.error('[API] Failed to start server:', err)
    }
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    stopApiServer()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopApiServer()
  void stopAssistant()
})
