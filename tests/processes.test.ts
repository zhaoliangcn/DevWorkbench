// 附录 B.6.2：进程监视器纯函数测试（ps/tasklist 解析与排序）
import { describe, it, expect } from 'vitest'
import {
  parsePsOutput,
  parseTasklistCsv,
  sortProcs,
} from '../src/workspaces/toolbox/tools/pure/processes'

const PS_RAW = [
  '  1234  12.5  3.2 /usr/local/bin/node server.js',
  '    1   0.0  0.1 /sbin/launchd',
  '  5678  45.0 88.9 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome --type=renderer',
].join('\n')

const TASKLIST_RAW = [
  '"chrome.exe","1234","Console","1","123,456 K"',
  '"explorer.exe","567","Console","1","45,678 K"',
].join('\n')

describe('parsePsOutput（B.6.2）', () => {
  it('前三数字字段 + 剩余整体为命令（含空格路径）', () => {
    const rows = parsePsOutput(PS_RAW)
    expect(rows).toHaveLength(3)
    expect(rows[0]).toEqual({ pid: 1234, cpu: 12.5, mem: 3.2, command: '/usr/local/bin/node server.js' })
    expect(rows[2].command).toContain('Google Chrome --type=renderer')
    expect(rows[2].cpu).toBe(45)
  })

  it('跳过表头与坏行（pid 非数字）', () => {
    const raw = '  PID  %CPU  %MEM COMMAND\nabc 1.0 1.0 bad\n' + PS_RAW
    const rows = parsePsOutput(raw)
    expect(rows).toHaveLength(3)
    expect(rows.every((r) => Number.isFinite(r.pid) && r.pid > 0)).toBe(true)
  })

  it('畸形数字行整行跳过，NaN 兜底为 0，空行忽略', () => {
    expect(parsePsOutput('abc 1.0 1.0 bad\n100 1..2 3 cmd\n\n')).toEqual([
      { pid: 100, cpu: 0, mem: 3, command: 'cmd' },
    ])
  })
})

describe('parseTasklistCsv（B.6.2）', () => {
  it('取进程名与 PID，内存 KB 转 MB', () => {
    const rows = parseTasklistCsv(TASKLIST_RAW)
    expect(rows).toEqual([
      { pid: 1234, cpu: 0, mem: 121, command: 'chrome.exe' },
      { pid: 567, cpu: 0, mem: 45, command: 'explorer.exe' },
    ])
  })

  it('坏行与内存缺失行被跳过或回退 0', () => {
    const rows = parseTasklistCsv('"only,name"\n"a.exe","9","Console","1","abc K"')
    expect(rows).toEqual([{ pid: 9, cpu: 0, mem: 0, command: 'a.exe' }])
  })
})

describe('sortProcs（B.6.2）', () => {
  const rows = parsePsOutput(PS_RAW)

  it('CPU 降序', () => {
    expect(sortProcs(rows, 'cpu', true).map((r) => r.pid)).toEqual([5678, 1234, 1])
  })

  it('PID 升序', () => {
    expect(sortProcs(rows, 'pid', false).map((r) => r.pid)).toEqual([1, 1234, 5678])
  })

  it('命令字符串排序且不修改原数组', () => {
    const copy = rows.slice()
    sortProcs(rows, 'command', false)
    expect(rows).toEqual(copy)
    expect(sortProcs(rows, 'command', true)[0].command).toBe('/usr/local/bin/node server.js')
  })
})
