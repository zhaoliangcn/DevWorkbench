// 安全加固回归测试（代码审查修复）：
// - vault.isInsideRoot：前缀校验须含 path.sep，同层目录/大小写不可越界
// - data 存储键白名单：拒绝 '..'、路径分隔符、非法字符
// - system.assertPort/assertPid：IPC 数值参数运行时校验
// - explorer root 登记表：未登记 root 拒绝
import { describe, it, expect, vi, beforeAll } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

// vi.mock 工厂先于模块体执行，临时目录名只能依赖全局（process），不得引用未初始化的 const
const { TMP_DIR } = vi.hoisted(() => {
  const base = process.env.TEMP || process.env.TMP || '/tmp'
  return { TMP_DIR: base.replace(/[\\/]+$/, '') + '/dw-ipc-hardening' }
})

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: {},
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
  nativeImage: {},
  app: { getPath: vi.fn(() => TMP_DIR) },
}))

vi.mock('../electron/api-server.js', () => ({ setVaultPath: vi.fn() }))

import { isInsideRoot } from '../electron/ipc/vault'
import { loadDataFile, saveDataFile } from '../electron/ipc/data'
import { assertPort, assertPid } from '../electron/ipc/system'
import { approveRoot, isApprovedRoot, requireApprovedRoot } from '../electron/ipc/explorer'

describe('vault.isInsideRoot（resolveSafe 越界回归）', () => {
  it('root 内路径放行（含 root 自身）', () => {
    const root = path.join(TMP_DIR, 'vault')
    expect(isInsideRoot(root, path.join(root, 'a.md'))).toBe(true)
    expect(isInsideRoot(root, path.join(root, 'sub', 'b.md'))).toBe(true)
    expect(isInsideRoot(root, root)).toBe(true)
  })

  it('同层前缀相似目录不放行（startsWith 缺 path.sep 的历史漏洞）', () => {
    const root = path.join(TMP_DIR, 'vault')
    const sibling = path.join(TMP_DIR, 'vault-evil', 'secret.md')
    expect(isInsideRoot(root, sibling)).toBe(false)
  })

  it('.. 穿越不放行', () => {
    const root = path.join(TMP_DIR, 'vault')
    expect(isInsideRoot(root, path.join(root, '..', 'outside.md'))).toBe(false)
  })

  it('win32 大小写不敏感', () => {
    if (process.platform !== 'win32') return
    const root = path.join(TMP_DIR, 'Vault')
    expect(isInsideRoot(root, path.join(TMP_DIR, 'vault', 'a.md'))).toBe(true)
    expect(isInsideRoot(root, path.join(TMP_DIR, 'VAULT-EVIL', 'x.md'))).toBe(false)
  })
})

describe('data 存储键白名单', () => {
  it('合法键可读写', () => {
    saveDataFile('dw-test-key_1', { a: 1 })
    expect(loadDataFile<{ a: number }>('dw-test-key_1')).toEqual({ a: 1 })
  })

  it('穿越/非法键抛错', () => {
    expect(() => saveDataFile('../evil', {})).toThrow('非法存储键')
    expect(() => loadDataFile('a/b')).toThrow('非法存储键')
    expect(() => loadDataFile('a\\b')).toThrow('非法存储键')
    expect(() => loadDataFile('.hidden')).toThrow('非法存储键')
    expect(() => loadDataFile('')).toThrow('非法存储键')
    expect(() => loadDataFile('k'.repeat(65))).toThrow('非法存储键')
  })
})

describe('system 数值参数校验', () => {
  it('assertPort：1-65535 整数放行，其余抛错', () => {
    expect(assertPort(1)).toBe(1)
    expect(assertPort(65535)).toBe(65535)
    expect(() => assertPort(0)).toThrow()
    expect(() => assertPort(65536)).toThrow()
    expect(() => assertPort(1.5)).toThrow()
    // 命令注入向量：数字之外的任何形态一律拒绝
    expect(() => assertPort('80; calc' as unknown as number)).toThrow()
  })

  it('assertPid：正整数放行，其余抛错', () => {
    expect(assertPid(1)).toBe(1)
    expect(() => assertPid(0)).toThrow()
    expect(() => assertPid(-1)).toThrow()
    expect(() => assertPid('1 & whoami' as unknown as number)).toThrow()
  })
})

describe('explorer root 登记表', () => {
  it('未登记 root 被拒绝', () => {
    expect(isApprovedRoot(path.join(TMP_DIR, 'not-picked'))).toBe(false)
    expect(() => requireApprovedRoot(path.join(TMP_DIR, 'not-picked'))).toThrow('未登记')
  })

  it('经对话框语义登记后放行（含 win32 大小写归一）', () => {
    const root = path.join(TMP_DIR, 'picked-project')
    approveRoot(root)
    expect(isApprovedRoot(root)).toBe(true)
    if (process.platform === 'win32') {
      expect(isApprovedRoot(root.toUpperCase())).toBe(true)
    }
    expect(requireApprovedRoot(root)).toBe(path.resolve(root))
  })

  it('登记表持久化：新读到的路径列表可恢复（同进程内验证落盘内容）', () => {
    const persisted = loadDataFile<string[]>('explorer-approved-roots') ?? []
    expect(persisted.length).toBeGreaterThan(0)
  })
})

beforeAll(() => {
  // 确保 userData 目录存在（data.ts 不主动创建读路径）
  fs.mkdirSync(TMP_DIR, { recursive: true })
})
