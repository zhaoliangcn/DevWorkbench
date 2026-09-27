/**
 * 进程列表解析（附录 B.6.2）。
 * 纯函数层：主进程返回原始 CLI 输出，解析与排序在此完成以便测试。
 * - darwin/linux：`ps -axo pid=,pcpu=,pmem=,comm=`（等号形式去表头）
 * - win32：`tasklist /FO CSV /NH`（无 CPU 列，内存 KB → MB）
 */

export interface ProcRow {
  pid: number
  /** CPU 占用 %（win32 无此数据，恒为 0） */
  cpu: number
  /** 内存占用 %（darwin/linux）或 MB（win32） */
  mem: number
  command: string
}

export type ProcSortKey = 'cpu' | 'mem' | 'pid' | 'command'

/** 解析 ps 输出：行首三个数字字段 + 剩余整体为命令（命令可含空格路径与参数） */
export function parsePsOutput(raw: string): ProcRow[] {
  const out: ProcRow[] = []
  const lineRe = /^(\d+)\s+([\d.]+)\s+([\d.]+)\s+(.+)$/
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const m = lineRe.exec(t)
    if (!m) continue // 表头或坏行
    out.push({ pid: Number(m[1]), cpu: Number(m[2]) || 0, mem: Number(m[3]) || 0, command: m[4] })
  }
  return out
}

/** 解析 tasklist CSV：仅取进程名与 PID，内存 "123,456 K" 转为 MB */
export function parseTasklistCsv(raw: string): ProcRow[] {
  const out: ProcRow[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    const cells = t.match(/"([^"]*)"/g)
    if (!cells || cells.length < 5) continue
    const command = cells[0].slice(1, -1)
    const pid = Number(cells[1].slice(1, -1))
    if (!Number.isFinite(pid) || pid <= 0) continue
    const kbStr = cells[4].slice(1, -1).replace(/[,\s]/g, '').replace(/K$/i, '')
    const kb = Number(kbStr)
    out.push({
      pid,
      cpu: 0,
      mem: Number.isFinite(kb) ? Math.round(kb / 1024) : 0,
      command,
    })
  }
  return out
}

/** 排序：数值列按数值，命令列按字符串；稳定且不修改原数组 */
export function sortProcs(rows: ProcRow[], key: ProcSortKey, desc: boolean): ProcRow[] {
  const sorted = rows.slice().sort((a, b) => {
    if (key === 'command') return a.command.localeCompare(b.command)
    return a[key] - b[key]
  })
  return desc ? sorted.reverse() : sorted
}
