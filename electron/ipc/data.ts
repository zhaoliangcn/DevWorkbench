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

function registerDataIpc() {
  ipcMain.handle('data:save', (_event, key: string, data: unknown) => {
    const filePath = path.join(getDataPath(), `${key}.json`)
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
    return true
  })

  ipcMain.handle('data:load', (_event, key: string) => {
    const filePath = path.join(getDataPath(), `${key}.json`)
    if (!fs.existsSync(filePath)) {
      return null
    }
    const content = fs.readFileSync(filePath, 'utf-8')
    return JSON.parse(content)
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
