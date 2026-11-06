// 文件解压主进程 IO 壳测试：会话绑定、分批落盘、同名策略、路径二次校验、取消清理
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => [{}]) },
}))

import { ipcMain, dialog } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { registerArchiveIpc } from '../electron/ipc/archive.js'

type Handler = (event: unknown, args?: unknown) => Promise<unknown>
type WriteBatchResult = {
  written: number
  skipped: number
  renamed: number
  overwritten: number
  dirs: number
  canceled: boolean
}
type FinishResult = {
  written: number
  overwritten: number
  skipped: number
  renamed: number
  dirs: number
  errors: string[]
  errorCount: number
  cleaned: number
  canceled: boolean
}

const handlers = new Map<string, Handler>()
const pickQueue: string[] = []

function base64(text: string): string {
  return Buffer.from(text, 'utf8').toString('base64')
}

async function invoke<T>(channel: string, args?: unknown): Promise<T> {
  const handler = handlers.get(channel)
  if (!handler) throw new Error(`未注册 IPC：${channel}`)
  return (await handler(null, args)) as T
}

beforeEach(() => {
  handlers.clear()
  pickQueue.length = 0
  vi.mocked(ipcMain.handle).mockImplementation(((channel: string, handler: Handler) => {
    handlers.set(channel, handler)
  }) as unknown as typeof ipcMain.handle)
  vi.mocked(dialog.showOpenDialog).mockImplementation((async () => {
    const picked = pickQueue.shift()
    return picked ? { canceled: false, filePaths: [picked] } : { canceled: true, filePaths: [] }
  }) as unknown as typeof dialog.showOpenDialog)
  registerArchiveIpc()
})

function tmp(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix))
}

describe('archive IPC 落盘', () => {
  it('选择压缩包 → 读取字节 → 写入文件/目录', async () => {
    const archiveDir = tmp('dw-archive-src-')
    const targetDir = tmp('dw-archive-dst-')
    const archivePath = path.join(archiveDir, 'sample.zip')
    fs.writeFileSync(archivePath, 'dummy archive bytes', 'utf8')
    pickQueue.push(archivePath, targetDir)

    const picked = await invoke<{ canceled: boolean; path: string; name: string; size: number }>('archive:pick')
    expect(picked.canceled).toBe(false)
    expect(picked.name).toBe('sample.zip')

    const target = await invoke<{ canceled: boolean; path: string }>('archive:pickTarget')
    expect(target.canceled).toBe(false)

    const read = await invoke<{ base64: string; size: number }>('archive:readBytes')
    expect(Buffer.from(read.base64, 'base64').toString('utf8')).toBe('dummy archive bytes')

    const { opId } = await invoke<{ opId: string }>('archive:writeStart', { conflict: 'rename' })
    const batch = await invoke<WriteBatchResult>('archive:writeBatch', {
      opId,
      items: [
        { path: 'dir', kind: 'dir' },
        { path: 'dir/hello.txt', kind: 'file', base64: base64('你好') },
      ],
    })
    expect(batch).toMatchObject({ written: 1, dirs: 1, canceled: false })

    const summary = await invoke<FinishResult>('archive:finish', { opId })
    expect(summary.written).toBe(1)
    expect(fs.readFileSync(path.join(targetDir, 'dir', 'hello.txt'), 'utf8')).toBe('你好')
  })

  it('rename / skip / overwrite 三种同名策略', async () => {
    const targetDir = tmp('dw-archive-conflict-')
    const archiveDir = tmp('dw-archive-src-')
    fs.writeFileSync(path.join(archiveDir, 'a.zip'), 'x')
    pickQueue.push(path.join(archiveDir, 'a.zip'), targetDir)
    await invoke('archive:pick')
    await invoke('archive:pickTarget')

    fs.writeFileSync(path.join(targetDir, 'exists.txt'), 'old')

    // rename：已有文件 → name (1).txt
    const renameOp = await invoke<{ opId: string }>('archive:writeStart', { conflict: 'rename' })
    const renamed = await invoke<WriteBatchResult>('archive:writeBatch', {
      opId: renameOp.opId,
      items: [{ path: 'exists.txt', kind: 'file', base64: base64('new-rename') }],
    })
    expect(renamed.renamed).toBe(1)
    expect(fs.readFileSync(path.join(targetDir, 'exists (1).txt'), 'utf8')).toBe('new-rename')
    expect(fs.readFileSync(path.join(targetDir, 'exists.txt'), 'utf8')).toBe('old')
    await invoke('archive:finish', { opId: renameOp.opId })

    // overwrite：直接替换旧内容
    const overwriteOp = await invoke<{ opId: string }>('archive:writeStart', { conflict: 'overwrite' })
    const overwritten = await invoke<WriteBatchResult>('archive:writeBatch', {
      opId: overwriteOp.opId,
      items: [{ path: 'exists.txt', kind: 'file', base64: base64('new-overwrite') }],
    })
    expect(overwritten.overwritten).toBe(1)
    expect(fs.readFileSync(path.join(targetDir, 'exists.txt'), 'utf8')).toBe('new-overwrite')
    await invoke('archive:finish', { opId: overwriteOp.opId })

    // skip：保留旧文件
    const skipOp = await invoke<{ opId: string }>('archive:writeStart', { conflict: 'skip' })
    const skipped = await invoke<WriteBatchResult>('archive:writeBatch', {
      opId: skipOp.opId,
      items: [{ path: 'exists.txt', kind: 'file', base64: base64('should-not-write') }],
    })
    expect(skipped.skipped).toBe(1)
    expect(fs.readFileSync(path.join(targetDir, 'exists.txt'), 'utf8')).toBe('new-overwrite')
    await invoke('archive:finish', { opId: skipOp.opId })
  })

  it('拒绝 ../ 越界路径并记录错误，不中断其余条目', async () => {
    const targetDir = tmp('dw-archive-unsafe-')
    const archiveDir = tmp('dw-archive-src-')
    fs.writeFileSync(path.join(archiveDir, 'a.zip'), 'x')
    pickQueue.push(path.join(archiveDir, 'a.zip'), targetDir)
    await invoke('archive:pick')
    await invoke('archive:pickTarget')

    const { opId } = await invoke<{ opId: string }>('archive:writeStart', { conflict: 'rename' })
    const batch = await invoke<WriteBatchResult>('archive:writeBatch', {
      opId,
      items: [
        { path: '../evil.txt', kind: 'file', base64: base64('evil') },
        { path: 'ok.txt', kind: 'file', base64: base64('ok') },
      ],
    })
    expect(batch.written).toBe(1)
    const summary = await invoke<FinishResult>('archive:finish', { opId })
    expect(summary.errorCount).toBe(1)
    expect(summary.errors[0]).toContain('非法解压路径')
    expect(fs.existsSync(path.join(targetDir, 'ok.txt'))).toBe(true)
  })

  it('取消后回收本次新建的文件与空目录', async () => {
    const targetDir = tmp('dw-archive-cancel-')
    const archiveDir = tmp('dw-archive-src-')
    fs.writeFileSync(path.join(archiveDir, 'a.zip'), 'x')
    pickQueue.push(path.join(archiveDir, 'a.zip'), targetDir)
    await invoke('archive:pick')
    await invoke('archive:pickTarget')

    fs.writeFileSync(path.join(targetDir, 'exists.txt'), 'old')
    const { opId } = await invoke<{ opId: string }>('archive:writeStart', { conflict: 'rename' })
    const batch = await invoke<WriteBatchResult>('archive:writeBatch', {
      opId,
      items: [
        { path: 'half/way/file.txt', kind: 'file', base64: base64('partial') },
        { path: 'exists.txt', kind: 'file', base64: base64('renamed-partial') },
      ],
    })
    expect(batch.written).toBe(2)
    expect(batch.renamed).toBe(1)

    await invoke('archive:cancel')
    const summary = await invoke<FinishResult>('archive:finish', { opId, abort: true })
    expect(summary.canceled).toBe(true)
    expect(summary.cleaned).toBeGreaterThan(0)
    expect(fs.existsSync(path.join(targetDir, 'half'))).toBe(false)
    expect(fs.existsSync(path.join(targetDir, 'exists (1).txt'))).toBe(false)
    expect(fs.readFileSync(path.join(targetDir, 'exists.txt'), 'utf8')).toBe('old')
    expect(fs.readdirSync(targetDir)).toEqual(['exists.txt'])
  })

  it('未选择输出目录时不能开始写入', async () => {
    const archiveDir = tmp('dw-archive-src-')
    fs.writeFileSync(path.join(archiveDir, 'a.zip'), 'x')
    pickQueue.push(path.join(archiveDir, 'a.zip'))
    await invoke('archive:pick')
    await expect(invoke('archive:writeStart', { conflict: 'rename' })).rejects.toThrow('请先选择解压输出目录')
  })
})
