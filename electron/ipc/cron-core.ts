// 附录 F：Cron 表达式解析与触发时间推算（纯函数，不引库）
// 5 字段：分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-7，0/7=周日)
// 语义对齐 vixie cron：日与周均受限时取「或」，单边受限取「且」
//
// F.4b 起本文件为唯一事实源：主进程 scheduler 与渲染层共用。
// 受 tsconfig.electron.json rootDir 约束，规范实现置于 electron 侧；
// 渲染层 src/workspaces/toolbox/utils/cron.ts 仅 re-export 本文件。
export interface CronRule {
  raw: string
  minutes: number[] // 0-59
  hours: number[] // 0-23
  daysOfMonth: number[] // 1-31
  months: number[] // 1-12
  daysOfWeek: number[] // 0-6（0=周日，7 归一化为 0）
  /** 原始字段是否为裸 `*`（决定日/周「或」语义） */
  domStar: boolean
  dowStar: boolean
}

interface FieldDef {
  name: string
  min: number
  max: number
}

const FIELD_DEFS: FieldDef[] = [
  { name: '分钟', min: 0, max: 59 },
  { name: '小时', min: 0, max: 23 },
  { name: '日', min: 1, max: 31 },
  { name: '月', min: 1, max: 12 },
  { name: '周', min: 0, max: 7 },
]

const ATOM_PATTERN = /^(\*|\d+|\d+-\d+)(?:\/(\d+))?$/

function parseField(raw: string, def: FieldDef): number[] {
  const values = new Set<number>()
  for (const atomRaw of raw.split(',')) {
    const atom = atomRaw.trim()
    if (!atom) throw new Error(`${def.name}字段存在空片段："${raw}"`)
    const m = ATOM_PATTERN.exec(atom)
    if (!m) throw new Error(`${def.name}字段片段非法："${atom}"`)
    const [, range, stepRaw] = m
    const step = stepRaw !== undefined ? parseInt(stepRaw, 10) : 1
    if (step < 1) throw new Error(`${def.name}字段步长必须 ≥1："${atom}"`)

    let lo: number
    let hi: number
    if (range === '*') {
      lo = def.min
      hi = def.max
    } else if (range.includes('-')) {
      const [a, b] = range.split('-').map((s) => parseInt(s, 10))
      if (a < def.min || a > def.max || b < def.min || b > def.max) {
        throw new Error(`${def.name}字段超出范围 ${def.min}-${def.max}："${atom}"`)
      }
      if (a > b) throw new Error(`${def.name}字段区间起点需 ≤ 终点："${atom}"`)
      lo = a
      hi = b
    } else {
      const a = parseInt(range, 10)
      if (a < def.min || a > def.max) {
        throw new Error(`${def.name}字段超出范围 ${def.min}-${def.max}："${atom}"`)
      }
      // vixie 语义：a/n 等价 a-max/n
      lo = a
      hi = stepRaw !== undefined ? def.max : a
    }
    for (let v = lo; v <= hi; v += step) values.add(v)
  }
  // 周 7 归一化为 0（周日）
  if (def.name === '周' && values.has(7)) {
    values.delete(7)
    values.add(0)
  }
  return [...values].sort((a, b) => a - b)
}

/** 解析 5 字段 cron 表达式；非法时抛出中文错误 */
export function parseCron(expr: string): CronRule {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`表达式需要 5 个字段（分 时 日 月 周），收到 ${parts.length} 个`)
  }
  const [minute, hour, dom, month, dow] = parts
  return {
    raw: expr.trim(),
    minutes: parseField(minute, FIELD_DEFS[0]),
    hours: parseField(hour, FIELD_DEFS[1]),
    daysOfMonth: parseField(dom, FIELD_DEFS[2]),
    months: parseField(month, FIELD_DEFS[3]),
    daysOfWeek: parseField(dow, FIELD_DEFS[4]),
    domStar: dom === '*',
    dowStar: dow === '*',
  }
}

function dayMatches(rule: CronRule, date: Date): boolean {
  const domOk = rule.daysOfMonth.includes(date.getDate())
  const dowOk = rule.daysOfWeek.includes(date.getDay())
  if (!rule.domStar && !rule.dowStar) return domOk || dowOk
  if (!rule.domStar) return domOk
  if (!rule.dowStar) return dowOk
  return true
}

/** 某一时刻（精确到分钟）是否命中规则（scheduler 轮询用） */
export function ruleMatches(rule: CronRule, date: Date): boolean {
  return (
    rule.months.includes(date.getMonth() + 1) &&
    rule.hours.includes(date.getHours()) &&
    rule.minutes.includes(date.getMinutes()) &&
    dayMatches(rule, date)
  )
}

/** 跳跃式推算 from 之后（不含 from）的 count 次触发时间（本地时区） */
export function nextRun(rule: CronRule, from: Date, count: number): Date[] {
  const out: Date[] = []
  if (count <= 0) return out
  // 从 from 下一分钟开始搜索
  let c = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1)
  // 跳数上限：稀疏表达式（如 2/29）按日跳约 1500 次/年，20000 次覆盖 5 年以上
  for (let hops = 0; hops < 20000 && out.length < count; hops++) {
    if (!rule.months.includes(c.getMonth() + 1)) {
      c = new Date(c.getFullYear(), c.getMonth() + 1, 1)
      continue
    }
    if (!dayMatches(rule, c)) {
      c = new Date(c.getFullYear(), c.getMonth(), c.getDate() + 1)
      continue
    }
    if (!rule.hours.includes(c.getHours())) {
      c = new Date(c.getFullYear(), c.getMonth(), c.getDate(), c.getHours() + 1)
      continue
    }
    if (!rule.minutes.includes(c.getMinutes())) {
      c = new Date(c.getFullYear(), c.getMonth(), c.getDate(), c.getHours(), c.getMinutes() + 1)
      continue
    }
    out.push(new Date(c.getTime()))
    c = new Date(c.getFullYear(), c.getMonth(), c.getDate(), c.getHours(), c.getMinutes() + 1)
  }
  return out
}

/** 便捷封装：解析 + 推算（expr 非法时抛错） */
export function getNextRuns(expr: string, from: Date, count = 10): Date[] {
  return nextRun(parseCron(expr), from, count)
}

/** 用单个值替换表达式的第 index 个字段（滑块编辑用） */
export function replaceField(expr: string, index: number, value: number | string): string {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) return expr
  parts[index] = String(value)
  return parts.join(' ')
}
