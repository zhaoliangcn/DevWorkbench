import { describe, expect, it } from 'vitest'
import {
  extractWikiLinks,
  parseWikiLink,
  escapeHtml,
  extractUnresolved,
  findUnlinkedMentions,
  wrapFirstUnlinkedMention,
  canBeWikiTarget,
} from '../src/workspaces/knowledge/utils/markdown'

describe('parseWikiLink（E.1 别名语法）', () => {
  it('无别名 → { target }', () => {
    expect(parseWikiLink('笔记名')).toEqual({ target: '笔记名', alias: null })
  })

  it('有别名 → target 与 alias 分离，且各自 trim', () => {
    expect(parseWikiLink('目标 | 别名')).toEqual({ target: '目标', alias: '别名' })
  })

  it('空别名视为无别名', () => {
    expect(parseWikiLink('目标|')).toEqual({ target: '目标', alias: null })
  })
})

describe('extractWikiLinks', () => {
  it('别名被剥离，仅返回 target，且去重', () => {
    expect(extractWikiLinks('[[A|别名]] 与 [[A]] 与 [[B]]')).toEqual(['A', 'B'])
  })

  it('空串无匹配、无死循环（回归：g 标志空匹配教训）', () => {
    expect(extractWikiLinks('')).toEqual([])
  })

  it('剔除空目标 [[|x]]', () => {
    expect(extractWikiLinks('[[|x]] [[A]]')).toEqual(['A'])
  })
})

describe('escapeHtml（E.1 XSS 修复）', () => {
  it('转义全部五类特殊字符', () => {
    expect(escapeHtml(`<a href="x" onclick='y'>&`)).toBe(
      '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;'
    )
  })

  it('属性注入payload 转义后不再破坏标签结构', () => {
    const evil = '"><img src=x onerror=alert(1)>'
    const escaped = escapeHtml(evil)
    expect(escaped).not.toContain('"<')
    expect(escaped).toContain('&quot;&gt;')
  })
})

describe('extractUnresolved（E.1 死链）', () => {
  const map = new Map([['A', 'id_a']])

  it('不在 titleToId 中的目标即死链，保持出现顺序', () => {
    expect(extractUnresolved('[[A]] 与 [[B]] 与 [[C]]', map)).toEqual(['B', 'C'])
  })

  it('已解析与空内容', () => {
    expect(extractUnresolved('[[A]]', map)).toEqual([])
    expect(extractUnresolved('', map)).toEqual([])
  })
})

describe('canBeWikiTarget', () => {
  it('含 [ ] | 的标题不可作为目标，空串不可', () => {
    expect(canBeWikiTarget('a|b')).toBe(false)
    expect(canBeWikiTarget('a]b')).toBe(false)
    expect(canBeWikiTarget('')).toBe(false)
    expect(canBeWikiTarget('普通标题')).toBe(true)
  })
})

describe('findUnlinkedMentions（E.1 提及未链接）', () => {
  it('纯文本提及命中，大小写不敏感', () => {
    expect(findUnlinkedMentions('今天读了 Design Patterns 一书', ['design patterns'])).toEqual([
      'design patterns',
    ])
  })

  it('已链接的 [[ ]] 内不视为提及', () => {
    expect(findUnlinkedMentions('见 [[设计模式]] 一书', ['设计模式'])).toEqual([])
  })

  it('wikilink 外的同一标题仍命中', () => {
    expect(findUnlinkedMentions('见 [[设计模式]]，还有旧笔记 设计模式。', ['设计模式'])).toEqual([
      '设计模式',
    ])
  })

  it('空正文返回空数组', () => {
    expect(findUnlinkedMentions('', ['任意'])).toEqual([])
  })
})

describe('wrapFirstUnlinkedMention（E.1 一键包裹）', () => {
  it('包裹首个纯文本提及', () => {
    expect(wrapFirstUnlinkedMention('这是一段 提及目标 的文本', '提及目标')).toBe(
      '这是一段 [[提及目标]] 的文本'
    )
  })

  it('跳过 wikilink 内部，包裹其后的提及', () => {
    expect(wrapFirstUnlinkedMention('[[提及目标|别名]] 和 提及目标', '提及目标')).toBe(
      '[[提及目标|别名]] 和 [[提及目标]]'
    )
  })

  it('无提及返回 null', () => {
    expect(wrapFirstUnlinkedMention('毫无关联', '提及目标')).toBeNull()
  })

  it('含 | 或 ] 的标题拒绝包裹（防破坏链接语法）', () => {
    expect(wrapFirstUnlinkedMention('a|b 在这里', 'a|b')).toBeNull()
  })
})
