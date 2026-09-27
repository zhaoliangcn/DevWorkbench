/**
 * 凭据保险库 IPC（附录 B.7）：secvault:* 命名空间。
 * 注意：vault:* 已被知识库 vault（附录 E.3.6）占用，凭据保险库使用 secvault:*。
 * 主密码只经 IPC 传参即时使用，主进程不持久化；会话解锁状态由渲染层持有。
 */
import { app, ipcMain } from 'electron'
import crypto from 'node:crypto'
import path from 'node:path'
import {
  createVaultFile,
  decryptEntryValue,
  encryptEntryValue,
  isPasswordValid,
  loadVaultFile,
  saveVaultFile,
  verifyMasterPassword,
} from './secvault-crypto.js'
import type { VaultEntryStored } from './secvault-crypto.js'

function vaultFilePath(): string {
  return path.join(app.getPath('userData'), 'credentials-vault.json')
}

function registerSecvaultIpc() {
  ipcMain.handle('secvault:status', async () => {
    const file = await loadVaultFile(vaultFilePath())
    return {
      initialized: file !== null,
      entryCount: file ? file.entries.length : 0,
    }
  })

  ipcMain.handle('secvault:init', async (_event, password: string) => {
    if (!isPasswordValid(password)) {
      return { success: false, error: '主密码至少 8 位' }
    }
    const filePath = vaultFilePath()
    const existing = await loadVaultFile(filePath)
    if (existing) return { success: false, error: '保险库已初始化' }
    await saveVaultFile(filePath, createVaultFile(password))
    return { success: true }
  })

  ipcMain.handle('secvault:verify', async (_event, password: string) => {
    const file = await loadVaultFile(vaultFilePath())
    if (!file) return { success: false, verified: false, error: '保险库未初始化' }
    return { success: true, verified: verifyMasterPassword(file, password) }
  })

  ipcMain.handle('secvault:list', async (_event, password: string) => {
    const file = await loadVaultFile(vaultFilePath())
    if (!file) return { success: false, entries: [], error: '保险库未初始化' }
    if (!verifyMasterPassword(file, password)) {
      return { success: false, entries: [], error: '主密码错误' }
    }
    return {
      success: true,
      entries: file.entries.map((e) => ({
        id: e.id,
        name: e.name,
        kind: e.kind,
        createdAt: e.createdAt,
      })),
    }
  })

  ipcMain.handle('secvault:get', async (_event, password: string, id: string) => {
    const file = await loadVaultFile(vaultFilePath())
    if (!file) return { success: false, value: '', error: '保险库未初始化' }
    const entry = file.entries.find((e) => e.id === id)
    if (!entry) return { success: false, value: '', error: '条目不存在' }
    try {
      return { success: true, value: decryptEntryValue(file, password, entry) }
    } catch {
      return { success: false, value: '', error: '解密失败（主密码错误或数据被篡改）' }
    }
  })

  ipcMain.handle(
    'secvault:put',
    async (_event, password: string, payload: { id?: string; name: string; kind: string; value: string }) => {
      const name = payload.name.trim()
      if (!name) return { success: false, error: '名称不能为空' }
      const kind = (['ssh', 'http', 'db', 'other'] as const).includes(payload.kind as never)
        ? (payload.kind as VaultEntryStored['kind'])
        : 'other'
      const filePath = vaultFilePath()
      const file = await loadVaultFile(filePath)
      if (!file) return { success: false, error: '保险库未初始化' }
      if (!verifyMasterPassword(file, password)) {
        return { success: false, error: '主密码错误' }
      }
      const blob = encryptEntryValue(file, password, payload.value)
      if (payload.id) {
        const idx = file.entries.findIndex((e) => e.id === payload.id)
        if (idx === -1) return { success: false, error: '条目不存在' }
        file.entries[idx] = { ...file.entries[idx], name, kind, blob }
      } else {
        file.entries.push({
          id: crypto.randomUUID(),
          name,
          kind,
          createdAt: new Date().toISOString(),
          blob,
        })
      }
      await saveVaultFile(filePath, file)
      return { success: true }
    }
  )

  ipcMain.handle('secvault:delete', async (_event, password: string, id: string) => {
    const filePath = vaultFilePath()
    const file = await loadVaultFile(filePath)
    if (!file) return { success: false, error: '保险库未初始化' }
    if (!verifyMasterPassword(file, password)) {
      return { success: false, error: '主密码错误' }
    }
    const before = file.entries.length
    file.entries = file.entries.filter((e) => e.id !== id)
    if (file.entries.length === before) return { success: false, error: '条目不存在' }
    await saveVaultFile(filePath, file)
    return { success: true }
  })
}

export { registerSecvaultIpc }
