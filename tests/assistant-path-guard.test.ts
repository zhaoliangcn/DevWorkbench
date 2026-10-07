// 宿主侧文件工具路径守卫测试：文件工具参数的越界拦截（对冲上游围栏缺口）
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { findOutsidePath, isInsideRoot, PATH_ARG_TOOLS } from '../electron/ipc/assistant-path-guard'

const WORK = path.resolve('/work/vault')
const sep = path.sep

describe('isInsideRoot', () => {
  it('域内放行（含域自身、子目录、相对解析）', () => {
    expect(isInsideRoot(WORK, WORK)).toBe(true)
    expect(isInsideRoot(WORK, path.join(WORK, 'a.md'))).toBe(true)
expect(isInsideRoot(WORK, path.resolve(WORK, 'sub/b.md'))).toBe(true)
  })

  it('同层前缀相似目录与 .. 穿越不放行', () => {
    expect(isInsideRoot(WORK, WORK + '-evil' + sep + 'x.md')).toBe(false)
    expect(isInsideRoot(WORK, path.resolve(WORK, '..' + sep + 'x.md'))).toBe(false)
  })

  it('win32 大小写不敏感', () => {
    if (process.platform !== 'win32') return
    expect(isInsideRoot('D:\\Work\\Vault', 'd:\\work\\vault\\a.md')).toBe(true)
    expect(isInsideRoot('D:\\Work\\Vault', 'D:\\Work\\VaultEvil\\a.md')).toBe(false)
  })
})

describe('findOutsidePath（工具参数拦截）', () => {
  it('每个文件工具的路径参数都被校验', () => {
    for (const tool of Object.keys(PATH_ARG_TOOLS)) {
      const { key, list } = PATH_ARG_TOOLS[tool]
      const outside = 'C:' + sep + 'Users' + sep + 'x' + sep + 'evil.md'
      const args = list ? { [key]: [outside] } : { [key]: outside }
      expect(findOutsidePath(tool, args, WORK)).toBe(outside)
    }
  })

  it('域内绝对路径与相对路径放行（工具结果回传绝对路径的正常往返）', () => {
    expect(findOutsidePath('read_file', { path: path.join(WORK, 'a.md') }, WORK)).toBeNull()
    expect(findOutsidePath('write_file', { path: 'notes/a.md' }, WORK)).toBeNull()
    expect(findOutsidePath('glob', { cwd: 'src' }, WORK)).toBeNull()
  })

  it('batch_read 多路径任一越界即报该路径', () => {
    const inside = path.join(WORK, 'ok.md')
    const outside = path.resolve(WORK, '..' + sep + 'out.md')
    expect(findOutsidePath('batch_read', { paths: [inside, outside] }, WORK)).toBe(outside)
  })

  it('非文件工具 / 缺参数 / 空路径不拦截', () => {
    expect(findOutsidePath('exec_command', { command: 'ls' }, WORK)).toBeNull()
    expect(findOutsidePath('read_file', {}, WORK)).toBeNull()
    expect(findOutsidePath('read_file', { path: '' }, WORK)).toBeNull()
    expect(findOutsidePath('list_directory', { depth: 3 }, WORK)).toBeNull()
  })

  it('args 非对象容错', () => {
    expect(findOutsidePath('read_file', null as unknown as Record<string, unknown>, WORK)).toBeNull()
    expect(findOutsidePath('read_file', { path: 123 }, WORK)).toBeNull()
  })
})
