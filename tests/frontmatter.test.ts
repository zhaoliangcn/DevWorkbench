import { describe, it, expect } from 'vitest'
import { parseFrontmatter, extractAllTags } from '../src/workspaces/knowledge/utils/frontmatter'

describe('parseFrontmatter 边界', () => {
  it('空串与无围栏返回空结果', () => {
    for (const content of ['', '普通正文 #标签', '正文\n---\n不算围栏']) {
      const fm = parseFrontmatter(content)
      expect(fm.tags).toEqual([])
      expect(fm.aliases).toEqual([])
      expect(fm.created).toBeNull()
      expect(fm.end).toBe(0)
    }
  })

  it('首行不是围栏（正文在前）不解析', () => {
    expect(parseFrontmatter('正文\n---\ntags: [a]\n---\n').tags).toEqual([])
  })

  it('围栏未闭合视为无 frontmatter', () => {
    const fm = parseFrontmatter('---\ntags: [a]\n正文继续')
    expect(fm.tags).toEqual([])
    expect(fm.end).toBe(0)
  })

  it('空围栏正常闭合', () => {
    const fm = parseFrontmatter('---\n---\n正文')
    expect(fm.tags).toEqual([])
    expect(fm.end).toBe('---\n---\n'.length)
  })

  it('CRLF 行尾正常解析', () => {
    const fm = parseFrontmatter('---\r\ntags: [a, b]\r\n---\r\n#标题 #正文')
    expect(fm.tags).toEqual(['a', 'b'])
  })
})

describe('parseFrontmatter 三键', () => {
  it('行内数组列表', () => {
    const fm = parseFrontmatter('---\ntags: [知识管理, Markdown]\naliases: [笔记, 备忘]\n---\n')
    expect(fm.tags).toEqual(['知识管理', 'Markdown'])
    expect(fm.aliases).toEqual(['笔记', '备忘'])
  })

  it('多行 - 列表', () => {
    const fm = parseFrontmatter('---\ntags:\n  - a\n  - b\naliases:\n  - 别名一\n---\n')
    expect(fm.tags).toEqual(['a', 'b'])
    expect(fm.aliases).toEqual(['别名一'])
  })

  it('标量单值', () => {
    expect(parseFrontmatter('---\ntags: 单标签\n---\n').tags).toEqual(['单标签'])
  })

  it('去引号并剥前导 #', () => {
    const fm = parseFrontmatter('---\ntags: ["#a", \'b\']\n---\n')
    expect(fm.tags).toEqual(['a', 'b'])
  })

  it('created 取原样字符串', () => {
    expect(parseFrontmatter('---\ncreated: 2026-09-27\n---\n').created).toBe('2026-09-27')
  })

  it('其他键与畸形行忽略', () => {
    const fm = parseFrontmatter('---\ntitle: X\n无冒号行\ntags: [a]\n---\n')
    expect(fm.tags).toEqual(['a'])
  })

  it('end 指向围栏后正文起始', () => {
    const content = '---\ntags: [a]\n---\n#正文'
    const fm = parseFrontmatter(content)
    expect(content.slice(fm.end)).toBe('#正文')
  })
})

describe('extractAllTags 合并去重', () => {
  it('frontmatter 优先 + 行内合并 + 去重保序', () => {
    const content = '---\ntags: [a, b]\n---\n正文 #b #c'
    expect(extractAllTags(content)).toEqual(['a', 'b', 'c'])
  })

  it('剥离 frontmatter 后再扫行内（围栏内 #不算）', () => {
    const content = '---\n# 注释里的 #假标签\ncreated: 2026-01-01\n---\n#真标签'
    expect(extractAllTags(content)).toEqual(['真标签'])
  })

  it('无 frontmatter 时等价于行内提取', () => {
    expect(extractAllTags('纯正文 #x #y')).toEqual(['x', 'y'])
  })

  it('空串返回空数组', () => {
    expect(extractAllTags('')).toEqual([])
  })
})
