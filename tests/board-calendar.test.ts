// 附录 B.5.2：看板/日历视图纯函数测试（frontmatter status 解析与写回、日历分组与月网格）
import { describe, it, expect } from 'vitest'
import { parseFrontmatter, updateFrontmatterKey } from '../src/workspaces/knowledge/utils/frontmatter'
import { dailyNoteDate, groupNotesByDate, monthGrid } from '../src/workspaces/knowledge/utils/calendar'

describe('parseFrontmatter：status 键（B.5.2）', () => {
  it('解析 status 标量值', () => {
    const fm = parseFrontmatter('---\ntags: [a]\nstatus: doing\n---\n正文')
    expect(fm.status).toBe('doing')
  })

  it('无 status 键时为 null；status 空值归 null', () => {
    expect(parseFrontmatter('---\ntags: [a]\n---\n正文').status).toBeNull()
    expect(parseFrontmatter('---\nstatus:\n---\n正文').status).toBeNull()
  })
})

describe('updateFrontmatterKey（B.5.2 看板拖拽写回）', () => {
  it('无 frontmatter 时在头部生成围栏', () => {
    const out = updateFrontmatterKey('正文第一行', 'status', 'todo')
    expect(out).toBe('---\nstatus: todo\n---\n\n正文第一行')
  })

  it('已有 frontmatter 且键不存在时在围栏内追加', () => {
    const out = updateFrontmatterKey('---\ntags: [a]\n---\n正文', 'status', 'doing')
    expect(out).toBe('---\ntags: [a]\nstatus: doing\n---\n正文')
  })

  it('键已存在时原位替换，保持其他键与正文不动', () => {
    const content = '---\nstatus: todo\ntags: [a]\n---\n正文'
    const out = updateFrontmatterKey(content, 'status', 'done')
    expect(out).toBe('---\nstatus: done\ntags: [a]\n---\n正文')
  })

  it('value 为 null 时删除该键行；键不存在时原样返回', () => {
    expect(updateFrontmatterKey('---\nstatus: todo\n---\n正文', 'status', null)).toBe('---\n---\n正文')
    expect(updateFrontmatterKey('---\ntags: [a]\n---\n正文', 'status', null)).toBe('---\ntags: [a]\n---\n正文')
    expect(updateFrontmatterKey('无围栏正文', 'status', null)).toBe('无围栏正文')
  })

  it('非法 key 与换行值被拦截；围栏未闭合不写回', () => {
    const content = '---\ntags: [a]\n---\n正文'
    expect(updateFrontmatterKey(content, 'bad key', 'x')).toBe(content)
    expect(updateFrontmatterKey(content, 'status', 'a\n---\n注入')).toBe('---\ntags: [a]\nstatus: a --- 注入\n---\n正文')
    expect(updateFrontmatterKey('---\n未闭合\n正文', 'status', 'todo')).toBe('---\n未闭合\n正文')
  })

  it('写回后再解析能读出 status（往返一致）', () => {
    const out = updateFrontmatterKey('---\ntags: [a]\n---\n正文', 'status', 'doing')
    expect(parseFrontmatter(out).status).toBe('doing')
    expect(parseFrontmatter(out).tags).toEqual(['a'])
  })
})

describe('calendar 纯函数（B.5.2 日历视图）', () => {
  const notes = [
    { id: 'a', path: 'daily/2026-09-27.md', title: '2026-09-27', updatedAt: 1 },
    { id: 'b', path: '2026-09-27-复盘.md', title: '复盘', updatedAt: 3 },
    { id: 'c', path: 'daily/2026-08-01.md', title: '八月', updatedAt: 2 },
    { id: 'd', path: '随笔.md', title: '普通笔记', updatedAt: 9 },
  ]

  it('dailyNoteDate 从路径/标题提取 YYYY-MM-DD；普通笔记为 null', () => {
    expect(dailyNoteDate(notes[0])).toBe('2026-09-27')
    expect(dailyNoteDate(notes[1])).toBe('2026-09-27')
    expect(dailyNoteDate(notes[3])).toBeNull()
  })

  it('groupNotesByDate 按日分组，同日按 updatedAt 降序', () => {
    const map = groupNotesByDate(notes)
    expect(map.get('2026-09-27')).toEqual(['b', 'a'])
    expect(map.get('2026-08-01')).toEqual(['c'])
    expect(map.size).toBe(2)
  })

  it('monthGrid：2026-09（9/1 周二）首行 lead=1，42 槽位', () => {
    const grid = monthGrid(2026, 9)
    expect(grid).toHaveLength(42)
    expect(grid[0]).toBeNull()
    expect(grid[1]).toBe(1)
    expect(grid[30]).toBe(30)
    expect(grid[31]).toBeNull()
  })

  it('monthGrid：2026-02 平年 28 天；闰年 2024-02 为 29 天', () => {
    expect(monthGrid(2026, 2).filter((d) => d !== null)).toHaveLength(28)
    expect(monthGrid(2024, 2).filter((d) => d !== null)).toHaveLength(29)
  })
})
