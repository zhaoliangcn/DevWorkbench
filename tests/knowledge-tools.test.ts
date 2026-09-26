// C.5 进阶版测试：knowledge_read_note 工具（主进程）
// 覆盖：正常读取、子目录、路径越界拒绝、文件不存在、目录、长文截断、offsetChars 分段、缺参、vault 未设置
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// vault.js 顶部 import electron（纯 Node 下不可加载），mock 掉并用可变状态控制 vault 路径
const state = vi.hoisted(() => ({ vaultDir: null as string | null }))
vi.mock('../electron/ipc/vault.js', () => ({
  getVaultPath: () => state.vaultDir,
}))

import { knowledgeReadNoteHandler } from '../electron/ipc/knowledge-tools'

type HandlerFn = (args: { arguments: Record<string, unknown> }) => Promise<{
  success: boolean
  content: string
}>

const handler = knowledgeReadNoteHandler as unknown as HandlerFn

const BIG_LEN = 25000

let tmpDir: string

beforeAll(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-note-test-'))
  state.vaultDir = tmpDir
  await fs.writeFile(path.join(tmpDir, 'note.md'), 'hello note content', 'utf8')
  await fs.mkdir(path.join(tmpDir, 'nested'))
  await fs.writeFile(path.join(tmpDir, 'nested', 'inner.md'), 'inner text', 'utf8')
  await fs.writeFile(path.join(tmpDir, 'big.md'), 'x'.repeat(BIG_LEN), 'utf8')
})

afterAll(async () => {
  state.vaultDir = null
  await fs.rm(tmpDir, { recursive: true, force: true })
})

describe('knowledge_read_note 正常路径', () => {
  it('读取相对路径笔记全文', async () => {
    const r = await handler({ arguments: { path: 'note.md' } })
    expect(r.success).toBe(true)
    expect(r.content).toBe('hello note content')
  })

  it('读取子目录笔记', async () => {
    const r = await handler({ arguments: { path: 'nested/inner.md' } })
    expect(r.success).toBe(true)
    expect(r.content).toBe('inner text')
  })

  it('读取 vault 内绝对路径', async () => {
    const r = await handler({ arguments: { path: path.join(tmpDir, 'note.md') } })
    expect(r.success).toBe(true)
    expect(r.content).toBe('hello note content')
  })
})

describe('knowledge_read_note 安全边界', () => {
  it('相对路径 ../ 逃逸 vault → 拒绝', async () => {
    const r = await handler({ arguments: { path: '../outside.md' } })
    expect(r.success).toBe(false)
    expect(r.content).toContain('路径越界')
  })

  it('绝对路径指向 vault 外（/etc/hosts）→ 拒绝', async () => {
    const r = await handler({ arguments: { path: '/etc/hosts' } })
    expect(r.success).toBe(false)
    expect(r.content).toContain('路径越界')
  })

  it('vault 未设置 → 提示未选择', async () => {
    state.vaultDir = null
    try {
      const r = await handler({ arguments: { path: 'note.md' } })
      expect(r.success).toBe(false)
      expect(r.content).toContain('尚未选择知识库')
    } finally {
      state.vaultDir = tmpDir
    }
  })
})

describe('knowledge_read_note 错误处理', () => {
  it('文件不存在 → 读取失败', async () => {
    const r = await handler({ arguments: { path: 'no-such.md' } })
    expect(r.success).toBe(false)
    expect(r.content).toContain('读取失败')
  })

  it('目标是目录 → 不是文件', async () => {
    const r = await handler({ arguments: { path: 'nested' } })
    expect(r.success).toBe(false)
    expect(r.content).toContain('不是文件')
  })

  it('缺少 path 参数 → 失败', async () => {
    const r = await handler({ arguments: {} })
    expect(r.success).toBe(false)
    expect(r.content).toContain('缺少 path')
  })
})

describe('knowledge_read_note 长文分段', () => {
  it('超过 20000 字符截断并提示续读偏移', async () => {
    const r = await handler({ arguments: { path: 'big.md' } })
    expect(r.success).toBe(true)
    expect(r.content).toContain(`全文 ${BIG_LEN} 字符`)
    expect(r.content).toContain('offsetChars=20000')
    // 正文恰为 20000 字符，截断提示从换行符后开始
    expect(r.content.indexOf('\n…（已截断')).toBe(20000)
  })

  it('offsetChars 续读返回剩余部分且无截断提示', async () => {
    const r = await handler({ arguments: { path: 'big.md', offsetChars: 24000 } })
    expect(r.success).toBe(true)
    expect(r.content).toContain('从偏移 24000 开始')
    expect(r.content).not.toContain('已截断')
    expect(r.content.replace('（从偏移 24000 开始）', '').length).toBe(BIG_LEN - 24000)
  })
})
