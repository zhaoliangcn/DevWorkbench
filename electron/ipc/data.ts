import { ipcMain, app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

function getDataPath(): string {
  const dataPath = app.getPath('userData')
  if (!fs.existsSync(dataPath)) {
    fs.mkdirSync(dataPath, { recursive: true })
  }
  return dataPath
}

/** 主进程侧直读数据文件（与 data:save 同一存储；cron scheduler 等内部模块复用） */
export function loadDataFile<T>(key: string): T | null {
  const filePath = path.join(getDataPath(), `${key}.json`)
  if (!fs.existsSync(filePath)) return null
  return JSON.parse(fs.readFileSync(filePath, 'utf-8')) as T
}

/** 主进程侧直写数据文件（与 data:load 同一存储） */
export function saveDataFile(key: string, data: unknown): void {
  const filePath = path.join(getDataPath(), `${key}.json`)
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

function registerDataIpc() {
  ipcMain.handle('data:save', (_event, key: string, data: unknown) => {
    saveDataFile(key, data)
    return true
  })

  ipcMain.handle('data:load', (_event, key: string) => {
    return loadDataFile(key)
  })

  ipcMain.handle('data:delete', (_event, key: string) => {
    const filePath = path.join(getDataPath(), `${key}.json`)
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath)
    }
    return true
  })
}

export { registerDataIpc }
