// 附录 F F.4a：Cron 解析与触发时间推算测试
// 覆盖：*/15、工作日 1-5、月/周组合（或语义）、2/29 闰年、dow 7 归一化、非法表达式拒绝
import { describe, it, expect } from 'vitest'
import { parseCron, nextRun, getNextRuns, replaceField, ruleMatches } from '../src/workspaces/toolbox/utils/cron'

describe('parseCron（解析）', () => {
  it('*/15：分钟展开为 0/15/30/45，其余字段全量', () => {
    const r = parseCron('*/15 * * * *')
    expect(r.minutes).toEqual([0, 15, 30, 45])
    expect(r.hours).toHaveLength(24)
    expect(r.daysOfMonth).toHaveLength(31)
    expect(r.months).toHaveLength(12)
    expect(r.daysOfWeek).toHaveLength(7)
  })

  it('0 9 * * 1-5：工作日早 9 点', () => {
    const r = parseCron('0 9 * * 1-5')
    expect(r.minutes).toEqual([0])
    expect(r.hours).toEqual([9])
    expect(r.daysOfWeek).toEqual([1, 2, 3, 4, 5])
    expect(r.dowStar).toBe(false)
    expect(r.domStar).toBe(true)
  })

  it('a/n 语义：5/10 等价 5-59/10', () => {
    expect(parseCron('5/10 * * * *').minutes).toEqual([5, 15, 25, 35, 45, 55])
  })

  it('列表与区间混合：0,30 8-10 * * *', () => {
    const r = parseCron('0,30 8-10 * * *')
    expect(r.minutes).toEqual([0, 30])
    expect(r.hours).toEqual([8, 9, 10])
  })

  it('周 7 归一化为 0（周日）', () => {
    expect(parseCron('0 0 * * 7').daysOfWeek).toEqual([0])
  })

  it('多余空白可容忍；raw 保留 trim 后原文', () => {
    const r = parseCron('  0   9 *  *   1-5 ')
    expect(r.raw).toBe('0   9 *  *   1-5')
    expect(r.hours).toEqual([9])
  })
})

describe('parseCron（非法表达式拒绝）', () => {
  const cases = [
    '0 9 * *', // 4 字段
    '0 9 * * * *', // 6 字段
    '', // 空
    '60 * * * *', // 分钟超范围
    '* 24 * * *', // 小时超范围
    '0 0 32 * *', // 日超范围
    '0 0 * 13 *', // 月超范围
    '0 0 * * 8', // 周超范围
    'a * * * *', // 非法原子
    '1- * * * *', // 区间残缺
    '*/0 * * * *', // 步长 0
    '0 0 5-2 * *', // 区间起点 > 终点
    '0 0 1,,2 * *', // 空片段
  ]
  it.each(cases)('拒绝：%s', (expr) => {
    expect(() => parseCron(expr)).toThrow()
  })
})

describe('nextRun（触发时间推算）', () => {
  it('*/15：从 10:07 起下一轮为 10:15/10:30/10:45/11:00', () => {
    const from = new Date(2026, 8, 27, 10, 7)
    const runs = nextRun(parseCron('*/15 * * * *'), from, 4)
    expect(runs).toHaveLength(4)
    expect([runs[0].getHours(), runs[0].getMinutes()]).toEqual([10, 15])
    expect([runs[1].getHours(), runs[1].getMinutes()]).toEqual([10, 30])
    expect([runs[2].getHours(), runs[2].getMinutes()]).toEqual([10, 45])
    expect([runs[3].getHours(), runs[3].getMinutes()]).toEqual([11, 0])
  })

  it('from 恰好命中触发分钟时严格排除自身', () => {
    const from = new Date(2026, 8, 27, 10, 15)
    const runs = nextRun(parseCron('*/15 * * * *'), from, 1)
    expect([runs[0].getHours(), runs[0].getMinutes()]).toEqual([10, 30])
  })

  it('from 带秒毫秒时截断到分钟再搜索（10:14:59.500 → 10:15）', () => {
    const from = new Date(2026, 8, 27, 10, 14, 59, 500)
    const runs = nextRun(parseCron('*/15 * * * *'), from, 1)
    expect([runs[0].getHours(), runs[0].getMinutes()]).toEqual([10, 15])
  })

  it('0 9 * * 1-5：周五中午 → 跳过周末，下一发是周一', () => {
    // 2026-09-25 是周五
    const from = new Date(2026, 8, 25, 12, 0)
    const runs = nextRun(parseCron('0 9 * * 1-5'), from, 3)
    // 周一 09-28、周二 09-29、周三 09-30
    expect(runs[0].getDate()).toBe(28)
    expect(runs[0].getDay()).toBe(1)
    expect(runs[1].getDay()).toBe(2)
    expect(runs[2].getDay()).toBe(3)
    for (const d of runs) {
      expect([d.getHours(), d.getMinutes()]).toEqual([9, 0])
    }
  })

  it('日/周均受限取「或」：0 0 2 * 0 → 2 号与每周日都触发', () => {
    // 2026-09-28 周一起算：10-02（周五，dom 2）、10-04（周日）
    const from = new Date(2026, 8, 28, 0, 0)
    const runs = nextRun(parseCron('0 0 2 * 0'), from, 2)
    expect([runs[0].getMonth(), runs[0].getDate()]).toEqual([9, 2])
    expect([runs[1].getMonth(), runs[1].getDate()]).toEqual([9, 4])
    expect(runs[1].getDay()).toBe(0)
  })

  it('月/周组合：0 12 * 6 0 → 6 月每个周日 12 点（首个 6/7）', () => {
    // 2026-06-01 是周一，首个周日为 6/7
    const from = new Date(2026, 0, 1)
    const runs = nextRun(parseCron('0 12 * 6 0'), from, 2)
    expect([runs[0].getMonth(), runs[0].getDate(), runs[0].getHours()]).toEqual([5, 7, 12])
    expect([runs[1].getMonth(), runs[1].getDate()]).toEqual([5, 14])
  })

  it('2/29 闰年：0 0 29 2 * → 下一发 2028-02-29', () => {
    const from = new Date(2026, 0, 1)
    const runs = nextRun(parseCron('0 0 29 2 *'), from, 1)
    expect(runs[0].getFullYear()).toBe(2028)
    expect([runs[0].getMonth(), runs[0].getDate()]).toEqual([1, 29])
  })

  it('不可能表达式（2 月 31 日）返回空数组且不卡死', () => {
    const from = new Date(2026, 0, 1)
    expect(nextRun(parseCron('0 0 31 2 *'), from, 3)).toEqual([])
  })

  it('count=0 返回空数组', () => {
    expect(nextRun(parseCron('* * * * *'), new Date(2026, 8, 27), 0)).toEqual([])
  })

  it('dow=7 与 dow=0 推算结果一致', () => {
    const from = new Date(2026, 8, 28, 0, 0)
    const a = nextRun(parseCron('0 8 * * 0'), from, 2)
    const b = nextRun(parseCron('0 8 * * 7'), from, 2)
    expect(a.map((d) => d.getTime())).toEqual(b.map((d) => d.getTime()))
  })
})

describe('ruleMatches（scheduler 轮询用）', () => {
  it('分钟级命中判定：分/时/日/月/周全中才为 true', () => {
    const rule = parseCron('0 9 * * 1-5')
    const hit = new Date(2026, 8, 28, 9, 0) // 周一 09:00
    const missMinute = new Date(2026, 8, 28, 9, 1)
    const missDow = new Date(2026, 8, 27, 9, 0) // 周日
    expect(ruleMatches(rule, hit)).toBe(true)
    expect(ruleMatches(rule, missMinute)).toBe(false)
    expect(ruleMatches(rule, missDow)).toBe(false)
  })

  it('日/周「或」语义在 ruleMatches 中保持', () => {
    const rule = parseCron('0 0 2 * 0')
    expect(ruleMatches(rule, new Date(2026, 9, 2, 0, 0))).toBe(true) // 2 号（周五）
    expect(ruleMatches(rule, new Date(2026, 9, 4, 0, 0))).toBe(true) // 周日
    expect(ruleMatches(rule, new Date(2026, 9, 5, 0, 0))).toBe(false) // 周一
  })
})

describe('便捷与辅助函数', () => {
  it('getNextRuns：解析 + 推算一步到位', () => {
    const runs = getNextRuns('0 9 * * 1-5', new Date(2026, 8, 25, 12, 0), 1)
    expect(runs[0].getDay()).toBe(1)
  })

  it('getNextRuns：非法表达式抛错', () => {
    expect(() => getNextRuns('bad', new Date(), 1)).toThrow()
  })

  it('replaceField：替换指定字段，其余保持', () => {
    expect(replaceField('0 9 * * 1-5', 0, 30)).toBe('30 9 * * 1-5')
    expect(replaceField('0 9 * * 1-5', 4, 3)).toBe('0 9 * * 3')
    expect(replaceField('0 9 * * 1-5', 2, 15)).toBe('0 9 15 * 1-5')
  })

  it('replaceField：非法表达式原样返回', () => {
    expect(replaceField('*', 0, 5)).toBe('*')
  })
})
