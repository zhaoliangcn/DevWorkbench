// 附录 B.5.4：间隔重复（Anki 化）纯函数测试（卡片提取、SM-2 简化调度、frontmatter 读写）
import { describe, it, expect } from 'vitest'
import {
  addDays,
  extractFlashcards,
  isDue,
  parseSrsState,
  schedule,
  toDateStr,
  writeSrsState,
  DEFAULT_SRS,
  type SrsState,
} from '../src/workspaces/knowledge/utils/spaced-repetition'

/** 固定基准日，避免测试依赖当天日期 */
const BASE = new Date(2026, 8, 27) // 2026-09-27 本地时区

describe('extractFlashcards：Q/A 提取（B.5.4）', () => {
  it('中文 问：/答： 前缀，标题行剥 # 后同样识别', () => {
    const md = '## 问：什么是闭包？\n答：函数和词法环境。\n\n## 问：未知笔记\n'
    const cards = extractFlashcards(md)
    expect(cards).toEqual([
      { q: '什么是闭包？', a: '函数和词法环境。' },
      { q: '未知笔记', a: '' },
    ])
  })

  it('英文 Q:/A: 前缀，答案吸收后续多行', () => {
    const md = 'Q: What is hoisting?\nA: Moving declarations to the top\nof the scope.\n'
    expect(extractFlashcards(md)).toEqual([
      { q: 'What is hoisting?', a: 'Moving declarations to the top\nof the scope.' },
    ])
  })

  it('代码围栏内的 Q/A 行不识别', () => {
    const md = 'Q: real\n```\nQ: in code\nA: fake\n```\n'
    expect(extractFlashcards(md)).toEqual([{ q: 'real', a: '' }])
  })

  it('非 Q/问 的标题行是卡片边界；孤立 A 行忽略；空问题过滤', () => {
    const md = 'Q: one\nA: ans\n## 附注\nA: stray\nQ: \nA: x\n'
    expect(extractFlashcards(md)).toEqual([{ q: 'one', a: 'ans' }])
  })

  it('frontmatter 围栏不干扰提取（--- 行不是标题边界）', () => {
    const md = '---\ntags: [flashcard]\n---\n问：一加一？\n答：二\n'
    expect(extractFlashcards(md)).toEqual([{ q: '一加一？', a: '二' }])
  })
})

describe('日期工具（B.5.4）', () => {
  it('toDateStr 本地时区零填充', () => {
    expect(toDateStr(BASE)).toBe('2026-09-27')
    expect(toDateStr(new Date(2026, 0, 5))).toBe('2026-01-05')
  })

  it('addDays 跨月/跨年', () => {
    expect(toDateStr(addDays(BASE, 5))).toBe('2026-10-02')
    expect(toDateStr(addDays(new Date(2026, 11, 31), 1))).toBe('2027-01-01')
  })
})

describe('schedule：SM-2 简化调度（B.5.4）', () => {
  it('新卡四档起步阶梯：hard=1 / good=2 / easy=4 天', () => {
    expect(schedule(DEFAULT_SRS, 'hard', BASE).interval).toBe(1)
    expect(schedule(DEFAULT_SRS, 'good', BASE).interval).toBe(2)
    expect(schedule(DEFAULT_SRS, 'easy', BASE).interval).toBe(4)
  })

  it('again 回炉：interval=1、reviews 清零、ease 按 SM-2 公式下降', () => {
    const next = schedule({ ease: 2.5, interval: 15, due: '2026-09-01', reviews: 3 }, 'again', BASE)
    expect(next).toEqual({ due: '2026-09-28', ease: 1.96, interval: 1, reviews: 0 })
  })

  it('连续 good：2 → 6 → interval×ease', () => {
    const s1 = schedule(DEFAULT_SRS, 'good', BASE)
    expect(s1).toEqual({ due: '2026-09-29', ease: 2.5, interval: 2, reviews: 1 })
    const s2 = schedule(s1, 'good', BASE)
    expect(s2.interval).toBe(6)
    const s3 = schedule(s2, 'good', BASE)
    expect(s3.interval).toBe(15) // round(6 × 2.5)
  })

  it('ease 调整：good 不变、easy +0.1、hard -0.14，且限幅 [1.3, 3.0]', () => {
    expect(schedule(DEFAULT_SRS, 'good', BASE).ease).toBe(2.5)
    expect(schedule(DEFAULT_SRS, 'easy', BASE).ease).toBe(2.6)
    expect(schedule(DEFAULT_SRS, 'hard', BASE).ease).toBe(2.36)
    // 连续 again：0.96 → 钳到 1.3
    let s: SrsState = { ...DEFAULT_SRS, ease: 1.5 }
    for (let i = 0; i < 3; i++) s = schedule(s, 'again', BASE)
    expect(s.ease).toBe(1.3)
    expect(schedule({ ...DEFAULT_SRS, ease: 2.95 }, 'easy', BASE).ease).toBeLessThanOrEqual(3.0)
  })

  it('easy 倍率用更新后的 ease（×ease×1.25）', () => {
    const s1 = schedule(DEFAULT_SRS, 'easy', BASE) // ease 2.6, interval 4
    const s2 = schedule(s1, 'easy', BASE) // reviews=2 → 8
    expect(s2.interval).toBe(8)
    const s3 = schedule(s2, 'easy', BASE) // ease 累计三次 +0.1 → 2.8，round(8 × 2.8 × 1.25) = 28
    expect(s3.interval).toBe(28)
  })

  it('间隔不缩水：低 ease 下 hard 仍至少 +1 天', () => {
    const s = schedule({ ease: 1.3, interval: 10, due: '2026-09-01', reviews: 3 }, 'hard', BASE)
    expect(s.interval).toBeGreaterThanOrEqual(11)
  })

  it('isDue：无 due 即到期；到期日比较按字符串', () => {
    expect(isDue({ ...DEFAULT_SRS })).toBe(true)
    expect(isDue({ due: '2026-09-27', ease: 2.5, interval: 1, reviews: 1 }, BASE)).toBe(true)
    expect(isDue({ due: '2026-09-28', ease: 2.5, interval: 1, reviews: 1 }, BASE)).toBe(false)
  })
})

describe('SRS 状态 frontmatter 读写（B.5.4）', () => {
  it('parseSrsState：完整四键解析', () => {
    const md = '---\ntags: [flashcard]\ndue: 2026-09-30\nease: 2.36\ninterval: 3\nreviews: 2\n---\n正文'
    expect(parseSrsState(md)).toEqual({ due: '2026-09-30', ease: 2.36, interval: 3, reviews: 2 })
  })

  it('缺键/非法值回退默认；无围栏与未闭合围栏视无状态', () => {
    expect(parseSrsState('---\ndue: not-a-date\nease: abc\n---\n正文')).toEqual(DEFAULT_SRS)
    expect(parseSrsState('---\nreviews: -1\ninterval: 2\n---\n正文')).toEqual({
      ...DEFAULT_SRS,
      interval: 2,
    })
    expect(parseSrsState('无围栏正文')).toEqual(DEFAULT_SRS)
    expect(parseSrsState('---\ndue: 2026-09-30\n正文')).toEqual(DEFAULT_SRS)
  })

  it('writeSrsState：无围栏生成头部围栏，往返一致', () => {
    const state: SrsState = { due: '2026-10-01', ease: 2.6, interval: 4, reviews: 1 }
    const out = writeSrsState('问：Q\n答：A', state)
    expect(out.startsWith('---\n')).toBe(true)
    expect(parseSrsState(out)).toEqual(state)
  })

  it('writeSrsState：已有围栏追加且保留原键与正文', () => {
    const state: SrsState = { due: '2026-10-01', ease: 2.5, interval: 2, reviews: 1 }
    const out = writeSrsState('---\ntags: [flashcard]\n---\n正文', state)
    expect(out).toContain('tags: [flashcard]')
    expect(out.endsWith('正文'))
    expect(parseSrsState(out)).toEqual(state)
  })

  it('writeSrsState：null 清除全部调度键', () => {
    const md = '---\ntags: [flashcard]\ndue: 2026-09-30\nease: 2.5\ninterval: 2\nreviews: 1\n---\n正文'
    const out = writeSrsState(md, null)
    expect(out).toContain('tags: [flashcard]')
    expect(parseSrsState(out)).toEqual(DEFAULT_SRS)
  })

  it('评分 → 写回 → 再解析 全链路一致', () => {
    const md = '---\ntags: [flashcard]\n---\n问：二进制 1010 是几？\n答：10'
    const graded = schedule(parseSrsState(md), 'good', BASE)
    const roundTrip = parseSrsState(writeSrsState(md, graded))
    expect(roundTrip).toEqual(graded)
  })
})
