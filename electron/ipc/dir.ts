import { ipcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveSafe, getVaultPath } from './vault.js'

/** 顶层保留目录：由专门机制管理（回收站/附件/模板），不允许经 dir:delete 整体删除 */
const RESERVED_TOP_LEVEL = new Set(['trash', 'attachments', 'templates'])

export function registerDirIpc() {
  ipcMain.handle('dir:list', () => {
    const result: string[] = []

    function walk(dir: string, prefix: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.isDirectory()) {
          const rel = prefix ? `${prefix}/${entry.name}` : entry.name
          result.push(rel)
          walk(path.join(dir, entry.name), rel)
        }
      }
    }

    walk(resolveSafe('.'), '')
    return result
  })

  ipcMain.handle('dir:create', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    if (!fs.existsSync(fullPath)) {
      fs.mkdirSync(fullPath, { recursive: true })
    }
  })

  ipcMain.handle('dir:delete', (_event, relativePath: string) => {
    const fullPath = resolveSafe(relativePath)
    // 防误删：拒绝根目录自身与顶层保留目录（递归删除不可逆）
    const vaultRoot = getVaultPath()
    if (vaultRoot && path.resolve(fullPath) === path.resolve(vaultRoot)) {
      throw new Error('不能删除知识库根目录')
    }
    const rel = vaultRoot ? path.relative(vaultRoot, fullPath) : ''
    const top = rel.split(path.sep)[0]
    if (top && RESERVED_TOP_LEVEL.has(top)) {
      throw new Error(`保留目录不可删除: ${top}/`)
    }
    if (fs.existsSync(fullPath)) {
      fs.rmSync(fullPath, { recursive: true })
    }
  })
}
