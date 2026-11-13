/**
 * 文件保险柜 IPC（主进程）。
 * - 主密码会话：解锁后派生密钥仅存本模块内存，锁定/退出即清零；闲置 autoLockMin 分钟自动锁定
 * - 错误密码节流：连续 5 次失败锁定 15 秒（scrypt 本身 ~100ms 已提供基础限速）
 * - 文件字节全程不进渲染层：添加/导出走原生对话框，主进程流式加解密；预览是唯一进内存的例外（≤5MB）
 * - 进度经 secfile:progress 推送；cancelFlag 由流 tap 检查，取消/失败清理半成品
 * - 不接入 AI 助手工具集：私密文件不应进入 LLM 上下文
 */
import { app, dialog, ipcMain, BrowserWindow } from 'electron'
import crypto from 'node:crypto'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { isPasswordValid, deriveKey } from './secvault-crypto.js'
import {
  createSecFileVault,
  verifyVaultPassword,
  encryptName,
  decryptName,
  encryptFileTo,
  decryptFileTo,
  decryptFileToBuffer,
  loadSecFileVault,
  saveSecFileVault,
  exportVaultBundle,
  importVaultBundle,
  CancelError,
  type SecFileVault,
} from './secfile-crypto.js'

const CONFIG_PATH = path.join(app.getPath('userData'), 'secfile-config.json')
const MAX_FAILS = 5
const COOLDOWN_MS = 15_000

const TEXT_EXT = new Set(['txt', 'md', 'json', 'ts', 'tsx', 'js', 'jsx', 'py', 'csv', 'log', 'xml', 'yaml', 'yml', 'ini', 'conf', 'html', 'css', 'sql', 'sh', 'bat'])
const IMAGE_EXT: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp', svg: 'image/svg+xml', ico: 'image/x-icon' }

/* ---------- 模块状态 ---------- */

let vaultDir: string | null = null
let vault: SecFileVault | null = null
let sessionKey: Buffer | null = null
let failCount = 0
let lockUntilTs = 0
let autoLockTimer: NodeJS.Timeout | null = null
let cancelFlag = false

function broadcast(payload: Record<string, unknown>) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('secfile:progress', payload)
  }
}

function lockVault() {
  sessionKey?.fill(0)
  sessionKey = null
  if (autoLockTimer) {
    clearTimeout(autoLockTimer)
    autoLockTimer = null
  }
}

/** 任何解锁态活动都重置自动锁定倒计时 */
function touch() {
  if (autoLockTimer) clearTimeout(autoLockTimer)
  autoLockTimer = null
  if (!sessionKey || !vault) return
  const min = Math.min(120, Math.max(1, vault.autoLockMin))
  autoLockTimer = setTimeout(() => {
    lockVault()
    broadcast({ op: 'autolock' })
  }, min * 60_000)
}

function requireUnlocked(): { key: Buffer; vault: SecFileVault; dir: string } {
  if (!sessionKey || !vault || !vaultDir) throw new Error('保险柜未解锁')
  touch()
  return { key: sessionKey, vault, dir: vaultDir }
}

async function persist(v: SecFileVault) {
  await saveSecFileVault(path.join(vaultDir!, 'vault.json'), v)
}

function statusPayload() {
  const exists = !!(vaultDir && vault)
  let entries: Array<{ id: string; name: string; size: number; addedAt: string }> = []
  if (sessionKey && vault) {
    entries = vault.entries.map((e) => {
      let name = '(无法解密)'
      try {
        name = decryptName(sessionKey!, e.nameBlob)
      } catch {
        // 条目名解密失败仍列出，不阻断整个列表
      }
      return { id: e.id, name, size: e.size, addedAt: e.addedAt }
    })
  }
  return { exists, unlocked: !!sessionKey, dir: vaultDir, autoLockMin: vault?.autoLockMin ?? 5, entries }
}

/* ---------- 对话框辅助 ---------- */

function parentWin() {
  return BrowserWindow.getAllWindows()[0]
}

async function pickDirectory(title: string): Promise<string | null> {
  const opts = {
    title,
    properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'>,
  }
  const r = parentWin() ? await dialog.showOpenDialog(parentWin(), opts) : await dialog.showOpenDialog(opts)
  return r.canceled || !r.filePaths[0] ? null : r.filePaths[0]
}

/* ---------- 注册 ---------- */

export function registerSecFileIpc() {
  try {
    if (fsSync.existsSync(CONFIG_PATH)) {
      const cfg = JSON.parse(fsSync.readFileSync(CONFIG_PATH, 'utf8'))
      if (typeof cfg.vaultDir === 'string' && fsSync.existsSync(cfg.vaultDir)) vaultDir = cfg.vaultDir
    }
  } catch {
    // 配置损坏按未创建处理
  }
  if (vaultDir) {
    void loadSecFileVault(path.join(vaultDir, 'vault.json')).then((v) => {
      if (v) vault = v
    })
  }

  ipcMain.handle('secfile:status', () => statusPayload())

  ipcMain.handle('secfile:pickDir', () => pickDirectory('选择保险柜目录'))

  ipcMain.handle('secfile:create', async (_e, arg: { dir: string; password: string; autoLockMin: number }) => {
    if (!isPasswordValid(arg.password)) return { ok: false, error: '主密码至少 8 位' }
    if (!arg.dir) return { ok: false, error: '请选择保险柜目录' }
    const vaultJson = path.join(arg.dir, 'vault.json')
    if (await fs.stat(vaultJson).then(() => true, () => false)) return { ok: false, error: '该目录已存在保险柜' }
    const sec = Math.min(120, Math.max(1, Math.round(arg.autoLockMin || 5)))
    const v = createSecFileVault(arg.password, sec)
    await fs.mkdir(path.join(arg.dir, 'files'), { recursive: true })
    vaultDir = arg.dir
    vault = v
    await persist(v)
    await fs.writeFile(CONFIG_PATH, JSON.stringify({ vaultDir }), 'utf8')
    sessionKey = verifyAndDerive(arg.password, v)
    touch()
    return { ok: true, status: statusPayload() }
  })

  ipcMain.handle('secfile:unlock', (_e, password: string) => {
    if (!vault) return { ok: false, error: '尚未创建保险柜' }
    const now = Date.now()
    if (now < lockUntilTs) {
      return { ok: false, error: `尝试次数过多，请 ${Math.ceil((lockUntilTs - now) / 1000)} 秒后重试` }
    }
    if (!verifyVaultPassword(vault, password)) {
      failCount++
      if (failCount >= MAX_FAILS) {
        lockUntilTs = now + COOLDOWN_MS
        failCount = 0
      }
      return { ok: false, error: '主密码错误' }
    }
    failCount = 0
    sessionKey = verifyAndDerive(password, vault)
    touch()
    return { ok: true, status: statusPayload() }
  })

  ipcMain.handle('secfile:lock', () => {
    lockVault()
    return { ok: true }
  })

  ipcMain.handle('secfile:pickFiles', async () => {
    const opts = { title: '选择要加密保存的文件', properties: ['openFile', 'multiSelections'] as Array<'openFile' | 'multiSelections'> }
    const r = parentWin() ? await dialog.showOpenDialog(parentWin(), opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  })

  ipcMain.handle('secfile:addPaths', async (_e, paths: string[]) => {
    const { key, vault: v, dir } = requireUnlocked()
    cancelFlag = false
    const added: string[] = []
    const errors: string[] = []
    for (const p of paths) {
      if (typeof p !== 'string') continue
      let st
      try {
        st = await fs.stat(p)
      } catch {
        errors.push(`${path.basename(String(p))}: 文件不存在`)
        continue
      }
      if (!st.isFile()) continue
      const id = crypto.randomUUID()
      const container = path.join(dir, 'files', `${id}.bin`)
      const tmp = `${container}.tmp`
      const name = path.basename(p)
      try {
        await encryptFileTo(p, tmp, key, (pct) => broadcast({ op: 'add', name, pct }), () => cancelFlag)
        if (cancelFlag) throw new CancelError()
        await fs.rename(tmp, container)
        v.entries.push({ id, size: st.size, addedAt: new Date().toISOString(), nameBlob: encryptName(key, name) })
        await persist(v)
        added.push(name)
        broadcast({ op: 'add', name, pct: 100, done: true })
      } catch (err) {
        await fs.rm(tmp, { force: true }).catch(() => {})
        errors.push(`${name}: ${err instanceof CancelError ? '已取消' : (err as Error).message}`)
        if (err instanceof CancelError) break
      }
    }
    touch()
    return { ok: added.length > 0, added, errors, status: statusPayload() }
  })

  ipcMain.handle('secfile:exportFile', async (_e, id: string) => {
    const { key, vault: v, dir } = requireUnlocked()
    const entry = v.entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: '文件不存在' }
    const name = decryptName(key, entry.nameBlob)
    const opts = { title: '导出文件', defaultPath: name, properties: ['createDirectory'] as Array<'createDirectory'> }
    const r = parentWin() ? await dialog.showSaveDialog(parentWin(), opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, error: '已取消' }
    cancelFlag = false
    try {
      await decryptFileTo(path.join(dir, 'files', `${id}.bin`), r.filePath, key, (pct) => broadcast({ op: 'export', name, pct }), () => cancelFlag)
      if (cancelFlag) throw new CancelError()
      broadcast({ op: 'export', name, pct: 100, done: true })
      return { ok: true }
    } catch (err) {
      await fs.rm(r.filePath, { force: true }).catch(() => {})
      return { ok: false, error: err instanceof CancelError ? '已取消' : (err as Error).message }
    } finally {
      touch()
    }
  })

  ipcMain.handle('secfile:remove', async (_e, id: string) => {
    const { vault: v, dir } = requireUnlocked()
    await fs.rm(path.join(dir, 'files', `${id}.bin`), { force: true })
    v.entries = v.entries.filter((e) => e.id !== id)
    await persist(v)
    touch()
    return { ok: true, status: statusPayload() }
  })

  ipcMain.handle('secfile:preview', (_e, id: string) => {
    const { key, vault: v, dir } = requireUnlocked()
    const entry = v.entries.find((e) => e.id === id)
    if (!entry) return { ok: false, error: '文件不存在' }
    const name = decryptName(key, entry.nameBlob)
    const ext = path.extname(name).slice(1).toLowerCase()
    const kind = IMAGE_EXT[ext] ? 'image' : TEXT_EXT.has(ext) ? 'text' : null
    if (!kind) return { ok: false, error: '该类型不支持预览（仅文本/图片，≤5MB）' }
    return decryptFileToBuffer(path.join(dir, 'files', `${id}.bin`), key)
      .then((buf) => {
        touch()
        return {
          ok: true,
          name,
          kind,
          mime: kind === 'image' ? IMAGE_EXT[ext] : 'text/plain',
          base64: buf.toString('base64'),
        }
      })
      .catch((err) => ({ ok: false, error: (err as Error).message }))
  })

  ipcMain.handle('secfile:exportBundle', async () => {
    const { vault: v, dir } = requireUnlocked()
    const opts = { title: '导出保险库', defaultPath: 'devworkbench-vault.wbvault' }
    const r = parentWin() ? await dialog.showSaveDialog(parentWin(), opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, error: '已取消' }
    cancelFlag = false
    try {
      await exportVaultBundle(dir, v, r.filePath, (pct) => broadcast({ op: 'bundle', pct }), () => cancelFlag)
      if (cancelFlag) throw new CancelError()
      broadcast({ op: 'bundle', pct: 100, done: true })
      return { ok: true }
    } catch (err) {
      await fs.rm(r.filePath, { force: true }).catch(() => {})
      return { ok: false, error: err instanceof CancelError ? '已取消' : (err as Error).message }
    } finally {
      touch()
    }
  })

  ipcMain.handle('secfile:pickBundleFile', async () => {
    const opts = {
      title: '选择保险库迁移文件',
      properties: ['openFile'] as Array<'openFile'>,
      filters: [{ name: '保险库迁移文件', extensions: ['wbvault'] }],
    }
    const r = parentWin() ? await dialog.showOpenDialog(parentWin(), opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : r.filePaths[0]
  })

  ipcMain.handle(
    'secfile:importBundle',
    async (_e, arg: { bundlePath: string; dir: string; password: string }) => {
      if (!arg.bundlePath || !arg.dir) return { ok: false, error: '缺少迁移文件或目标目录' }
      const vaultJson = path.join(arg.dir, 'vault.json')
      if (await fs.stat(vaultJson).then(() => true, () => false)) return { ok: false, error: '目标目录已存在保险柜' }
      try {
        const { count } = await importVaultBundle(arg.bundlePath, arg.dir, arg.password)
        vaultDir = arg.dir
        vault = await loadSecFileVault(vaultJson)
        await fs.writeFile(CONFIG_PATH, JSON.stringify({ vaultDir }), 'utf8')
        lockVault()
        return { ok: true, count, status: statusPayload() }
      } catch (err) {
        return { ok: false, error: (err as Error).message }
      }
    }
  )

  ipcMain.handle('secfile:cancel', () => {
    cancelFlag = true
    return { ok: true }
  })
}

/** 已验密的密码 → 派生会话密钥 */
function verifyAndDerive(password: string, v: SecFileVault): Buffer {
  return deriveKey(password, v.salt)
}

export { lockVault as lockSecFileOnQuit }
