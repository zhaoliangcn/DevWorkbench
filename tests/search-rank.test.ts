import { describe, expect, it } from 'vitest'
import { rankSearch, extractSnippet } from '../src/workspaces/knowledge/utils/search'
import type { Note } from '../src/types'

function makeNote(partial: Partial<Note> & { id: string }): Note {
  return {
    title: '',
    content: '',
    path: `${partial.id}.md`,
    createdAt: 0,
    updatedAt: 0,
    tags: [],
    ...partial,
  }
}

describe('rankSearch（附录 E E.3.2 搜索升级）', () => {
  const notes = [
    makeNote({ id: 'a', title: 'JSON 入门', content: '纯标题命中不含关键词', updatedAt: 1 }),
    makeNote({ id: 'b', title: '无关笔记', content: '正文里提到 json 一词', updatedAt: 9 }),
    makeNote({ id: 'c', title: '标签命中', content: 'x'.repeat(50), tags: ['json'], updatedAt: 5 }),
    makeNote({ id: 'd', title: 'JSON 双命中', content: 'json 与 json', updatedAt: 2 }),
  ]

  it('权重排序：双命中(4) > 标题(3) > 标签(2) > 正文(1)，updatedAt 只决胜平分', () => {
    const hits = rankSearch(notes, 'json')
    expect(hits.map((h) => h.note.id)).toEqual(['d', 'a', 'c', 'b'])
  })

  it('标题+正文双命中分数高于单标题命中', () => {
    const hits = rankSearch(notes, 'json')
    const scoreOf = (id: string) => hits.find((h) => h.note.id === id)!.score
    expect(scoreOf('d')).toBe(4)
    expect(scoreOf('a')).toBe(3)
    expect(scoreOf('d')).toBeGreaterThan(scoreOf('b'))
  })

  it('标签命中 ×2，且无正文片段', () => {
    const hits = rankSearch(notes, 'json')
    const c = hits.find((h) => h.note.id === 'c')!
    expect(c.score).toBe(2)
    expect(c.snippet).toBeNull()
  })

  it('分数相同按 updatedAt 新者优先', () => {
    const ties = [
      makeNote({ id: 'old', title: '主题', updatedAt: 1 }),
      makeNote({ id: 'new', title: '主题', updatedAt: 99 }),
    ]
    const hits = rankSearch(ties, '主题')
    expect(hits[0].note.id).toBe('new')
  })

  it('空查询/无命中返回空数组；正则特殊字符按字面处理', () => {
    expect(rankSearch(notes, '   ')).toEqual([])
    expect(rankSearch(notes, '不存在的词')).toEqual([])
    expect(rankSearch(notes, '[[')).toEqual([])
  })
})

describe('extractSnippet（正文上下文片段）', () => {
  it('截取首个命中点前后各 40 字并压缩空白', () => {
    const content = `${'前'.repeat(60)}关键词${'后'.repeat(60)}`
    const s = extractSnippet(content, '关键词')!
    expect(s).toContain('…')
    expect(s).toContain('关键词')
    expect(s.length).toBeLessThan(110)
    expect(s).not.toMatch(/\s{2,}/)
  })

  it('命中在开头时不带前导省略号', () => {
    const s = extractSnippet('关键词在最前面', '关键词')!
    expect(s.startsWith('…')).toBe(false)
    expect(s).toBe('关键词在最前面')
  })

  it('大小写不敏感定位，未命中与空输入返回 null', () => {
    expect(extractSnippet('hello world', 'WORLD')).toBe('hello world')
    expect(extractSnippet('hello world', 'xyz')).toBeNull()
    expect(extractSnippet('', 'x')).toBeNull()
    expect(extractSnippet('abc', '')).toBeNull()
  })
})
