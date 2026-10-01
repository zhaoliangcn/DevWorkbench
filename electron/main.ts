import { app, BrowserWindow } from 'electron'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadApiConfig } from './api-config.js'
import { startApiServer, stopApiServer, setVaultPath } from './api-server.js'
import { ensureVault, registerVaultIpc, getVaultPath, startVaultWatcher } from './ipc/vault.js'
import { registerFileIpc } from './ipc/file.js'
import { registerDirIpc } from './ipc/dir.js'
import { registerToolboxIpc } from './ipc/index.js'
import { registerIconConvertIpc } from './ipc/icon-convert.js'
import { registerHttpIpc } from './ipc/http.js'
import { registerWebhookIpc, stopWebhookServer } from './ipc/webhook.js'
import { registerCronIpc, stopCronScheduler } from './ipc/cron.js'
import { registerRedisIpc, stopRedisAll } from './ipc/redis.js'
import { registerSqliteIpc, stopSqlite } from './ipc/sqlite.js'
import { registerAssistantIpc, stopAssistant } from './ipc/assistant.js'
import { registerDockerIpc } from './ipc/docker.js'
import { registerEnvfileIpc } from './ipc/envfile.js'
import { registerSecvaultIpc } from './ipc/secvault.js'

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
    // 应用图标：macOS 用 icns，Windows 用 ico（打包时由 electron-builder 处理）
    icon: path.resolve(__dirname, '..', 'icons', process.platform === 'darwin' ? 'devworkbench.icns' : 'devworkbench.ico'),
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
  startVaultWatcher() // vault 监听（附录 E E.3.6）：外部变更 → vault:changed 推送

  // 注册各命名空间的 IPC handler
  registerVaultIpc()
  registerFileIpc()
  registerDirIpc()
  // Phase 3: 工具箱（ssh/system/data/app）
  registerToolboxIpc()
  // 工具箱：图标格式转换（iconconvert:*）
  registerIconConvertIpc()
  // 附录 F F.2: HTTP 请求下沉主进程（http:request）
  registerHttpIpc()
  // 附录 F F.3: Webhook 接收器（webhook:* 命名空间）
  registerWebhookIpc()
  // 附录 F F.4b: Cron 触发调度器（cron:* 命名空间，HTTP/脚本目标）
  registerCronIpc()
  // 附录 F F.5: Redis 客户端（redis:* 命名空间）
  registerRedisIpc()
  // 附录 F F.6: SQLite 浏览器（sqlite:* 命名空间）
  registerSqliteIpc()
  // Phase 6: AI 助手（assistant:* 命名空间）
  registerAssistantIpc()
  // 附录 B.6.1: Docker 管理面板（docker:* 命名空间）
  registerDockerIpc()
  // 附录 B.6.3: .env 管理器（envfile:* 命名空间）
  registerEnvfileIpc()
  // 附录 B.7: 凭据保险库（secvault:* 命名空间）
  registerSecvaultIpc()

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
    stopWebhookServer()
    stopCronScheduler()
    void stopRedisAll()
    stopSqlite()
    app.quit()
  }
})

app.on('before-quit', () => {
  stopApiServer()
  stopCronScheduler()
  void stopRedisAll()
  stopSqlite()
  void stopAssistant()
})
