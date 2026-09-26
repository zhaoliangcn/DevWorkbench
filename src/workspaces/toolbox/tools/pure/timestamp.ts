/**
 * 时间戳 ↔ 日期转换纯函数（切片 B）。与主进程 toolbox_timestamp 契约逻辑成对。
 */

export interface TimestampInput {
  value: string
  action: 'toDatetime' | 'toUnix'
  /** toDatetime 时附带的展示时区（'local' 或 IANA 名称） */
  tz?: string
}

export interface TimestampOutput {
  result: string
  error?: string
}

export function formatInTimezone(date: Date, tz: string): string {
  return date.toLocaleString('zh-CN', {
    timeZone: tz === 'local' ? undefined : tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export function timestampTransform({ value, action, tz }: TimestampInput): TimestampOutput {
  if (action === 'toDatetime') {
    const ts = parseInt(value, 10)
    if (Number.isNaN(ts)) return { result: '', error: '无效的时间戳' }
    const date = new Date(ts > 1e12 ? ts : ts * 1000)
    if (isNaN(date.getTime())) return { result: '', error: '无效的时间戳' }
    const lines = [date.toISOString(), `本地: ${date.toLocaleString('zh-CN')}`]
    if (tz) lines.push(`${tz}: ${formatInTimezone(date, tz)}`)
    return { result: lines.join('\n') }
  }
  const date = new Date(value)
  if (isNaN(date.getTime())) return { result: '', error: '无效的日期格式' }
  return { result: `秒: ${Math.floor(date.getTime() / 1000)}\n毫秒: ${date.getTime()}` }
}
