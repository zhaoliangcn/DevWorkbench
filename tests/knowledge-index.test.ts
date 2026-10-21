// 知识库内存索引测试：打分纯函数 + 索引扫描/增量事件/全局清单
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { splitTerms, extractTags, extractAliases, scoreNoteTerms } from '../electron/ipc/knowledge-score'
import {
  ensureVaultIndex,
  notifyVaultEvent,
  indexSearch,
  indexList,
  indexedCount,
  indexedRoot,
  isIndexReady,
} from '../electron/ipc/knowledge-index'

describe('knowledge-score 纯函数', () => {
  it('splitTerms：多空白拆词 + 小写归一', () => {
    expect(splitTerms('  Electron   IPC ')).toEqual(['electron', 'ipc'])
    expect(splitTerms('')).toEqual([])
  })

  it('extractTags：行内 #tag + frontmatter tags 行，标题不误判', () => {
    const content = '# 标题\n\n正文 #electron 笔记\n\ntags: [ipc, "dev-tool"]\n'
    const tags = extractTags(content)
    expect(tags).toContain('electron')
    expect(tags).toContain('ipc')
    expect(tags).toContain('dev-tool')
    // '# 标题'（# 后跟空格）不是标签
    expect(tags).not.toContain('标题')
  })

  it('extractAliases：frontmatter aliases 行，缺省为空', () => {
    expect(extractAliases('---\naliases: [IpcGuide, "进程通信"]\n---\n正文')).toEqual(['ipcguide', '进程通信'])
    expect(extractAliases('无别名')).toEqual([])
  })

  it('scoreNoteTerms：标题×3 / 标签×2 / 别名×2 / 正文×1', () => {
    const content = '正文提到 alpha\ntags: [beta]\naliases: [Gamma]\n'
    // 标题+正文 = 4
    expect(scoreNoteTerms('alpha 笔记', content, ['alpha']).score).toBe(4)
    // 标签+正文 = 3
    expect(scoreNoteTerms('无关', content, ['beta']).score).toBe(3)
    // 别名+正文 = 3
    expect(scoreNoteTerms('无关', content, ['gamma']).score).toBe(3)
    // 零命中
    expect(scoreNoteTerms('无关', content, ['delta'])).toEqual({ score: 0, snippet: null })
  })

  it('scoreNoteTerms：多词累加，全中排前；片段取首个命中词上下文', () => {
    const both = 'electron ipc 校验入口'
    const single = 'electron 笔记'
    const a = scoreNoteTerms('a', both, ['electron', 'ipc'])
    const b = scoreNoteTerms('b', single, ['electron', 'ipc'])
    expect(a.score).toBeGreaterThan(b.score)
    expect(a.snippet).toContain('electron')
  })
})

describe('knowledge-index 扫描与检索', () => {
  let dir1: string
  let dir2: string

  beforeAll(async () => {
    dir1 = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-idx-a-'))
    dir2 = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-idx-b-'))
    await fs.writeFile(path.join(dir1, 'electron-ipc.md'), '主进程 IPC 校验规则\ntags: [electron]\naliases: [IpcRule]\n', 'utf8')
    await fs.mkdir(path.join(dir1, 'sub'))
    await fs.writeFile(path.join(dir1, 'sub', 'note.md'), '一篇普通笔记，提及 electron', 'utf8')
    await fs.mkdir(path.join(dir1, 'trash'), { recursive: true })
    await fs.writeFile(path.join(dir1, 'trash', 'junk.md'), 'electron in trash', 'utf8')
    await fs.mkdir(path.join(dir1, 'attachments'), { recursive: true })
    await fs.writeFile(path.join(dir1, 'attachments', 'a.md'), 'electron in attachments', 'utf8')
    await fs.writeFile(path.join(dir1, 'not-md.txt'), 'electron 但不是 md', 'utf8')
    await fs.writeFile(path.join(dir2, 'only-b.md'), 'B 库独有内容', 'utf8')
  })

  afterAll(async () => {
    await fs.rm(dir1, { recursive: true, force: true })
    await fs.rm(dir2, { recursive: true, force: true })
  })

  it('ensureVaultIndex：全量扫描，跳过 trash/attachments 与非 md', async () => {
    await ensureVaultIndex(dir1)
    expect(isIndexReady(dir1)).toBe(true)
    expect(indexedRoot()).toBe(dir1)
    expect(indexedCount()).toBe(2) // electron-ipc.md + sub/note.md
  })

  it('indexSearch：多词 AND 语义优先排序，返回片段', () => {
    const hits = indexSearch('electron 校验')
    expect(hits[0]?.relPath).toBe('electron-ipc.md') // 标题×3+标签×2+正文×1
    expect(hits[0]?.snippet).toContain('校验')
    // 单词也能命中子目录笔记
    expect(indexSearch('普通').map((h) => h.relPath)).toContain('sub/note.md')
  })

  it('notifyVaultEvent：add/change/unlink 增量维护；错误 vault 根与 trash 忽略', async () => {
    // add：外部新增文件
    await fs.writeFile(path.join(dir1, 'fresh.md'), '新文件含 quantum', 'utf8')
    notifyVaultEvent('fresh.md', 'add', dir1)
    await new Promise((r) => setTimeout(r, 30))
    expect(indexSearch('quantum').map((h) => h.relPath)).toContain('fresh.md')

    // change：内容更新反映到索引
    await fs.writeFile(path.join(dir1, 'fresh.md'), '改成 relay 主题', 'utf8')
    notifyVaultEvent('fresh.md', 'change', dir1)
    await new Promise((r) => setTimeout(r, 30))
    expect(indexSearch('quantum')).toHaveLength(0)
    expect(indexSearch('relay').map((h) => h.relPath)).toContain('fresh.md')

    // unlink：真实场景磁盘文件已删除，索引同步移除
    await fs.rm(path.join(dir1, 'fresh.md'))
    notifyVaultEvent('fresh.md', 'unlink', dir1)
    expect(indexSearch('relay')).toHaveLength(0)

    // 错误 vault 根 / trash 路径：忽略
    expect(indexedCount()).toBe(2)
    notifyVaultEvent('ghost.md', 'change', '/not/this/vault')
    notifyVaultEvent('trash/hidden.md', 'change', dir1)
    await new Promise((r) => setTimeout(r, 30))
    expect(indexedCount()).toBe(2)
  })

  it('indexList：字典序 + 标签摘要 + total 与 limit 截断', () => {
    const all = indexList(300)
    expect(all.total).toBe(2)
    expect(all.lines[0]).toMatch(/^- electron-ipc\.md/)
    expect(all.lines[0]).toContain('#electron')
    const capped = indexList(1)
    expect(capped.lines).toHaveLength(1)
  })

  it('切换 vault 根：重建索引', async () => {
    await ensureVaultIndex(dir2)
    expect(indexedCount()).toBe(1)
    expect(indexSearch('独有').map((h) => h.relPath)).toEqual(['only-b.md'])
    // 切回 dir1，后续不再有依赖 dir2 索引的用例
    await ensureVaultIndex(dir1)
    expect(indexedCount()).toBe(2)
  })
})
