import { dialog, ipcMain } from 'electron'
import { promises as fs } from 'node:fs'
import path from 'node:path'

const MAX_ENV_BYTES = 2 * 1024 * 1024 // 2MB 上限，.env 远小于此

function registerEnvfileIpc() {
  // 多选打开 .env 文件，返回绝对路径（读取由 envfile:read 承担）
  ipcMain.handle('envfile:pick', async () => {
    const result = await dialog.showOpenDialog({
      title: '打开 .env 文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: '环境变量文件', extensions: ['env'] },
        { name: '所有文件', extensions: ['*'] },
      ],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true, files: [] }
    }
    return {
      success: true,
      canceled: false,
      files: result.filePaths.map((p) => ({ path: p, name: path.basename(p) })),
    }
  })

  ipcMain.handle('envfile:read', async (_event, filePath: string) => {
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) return { success: false, raw: '', error: '不是普通文件' }
      if (stat.size > MAX_ENV_BYTES) return { success: false, raw: '', error: '文件超过 2MB 上限' }
      const raw = await fs.readFile(filePath, 'utf8')
      return { success: true, raw }
    } catch (e) {
      return { success: false, raw: '', error: (e as Error).message }
    }
  })
}

export { registerEnvfileIpc }
