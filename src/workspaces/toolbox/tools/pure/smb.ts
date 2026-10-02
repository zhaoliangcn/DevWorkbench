/**
 * SMB 共享管理（工具箱）纯函数层。
 * 主进程通道保持薄：smb:list 返回原始输出，解析在此完成以便 vitest 直测。
 * 注意：主进程侧校验（isSafeShareName/isSafeSharePath）在 electron/ipc/smb.ts
 * 本地实现——tsconfig.electron 的 rootDir 限制主进程不能反向 import src/。
 */

export interface SmbShareRow {
  name: string
  /** 共享资源路径（Linux/macOS 解析自 conf/输出；Windows 取 net share 资源列） */
  path: string
  remark: string
}

/** 切点切进单词（左右均非空白）时回退到该词起点，避免劈开列文本 */
function adjustSplit(t: string, col: number): number {
  if (col > 0 && col < t.length && !/\s/.test(t[col - 1]) && !/\s/.test(t[col])) {
    let i = col - 1
    while (i > 0 && !/\s/.test(t[i - 1])) i--
    return i
  }
  return col
}

/**
 * Windows `net share` 表格输出解析（中英文系统均适配）。
 * 资源列可能含空格路径且与备注列仅靠固定列宽分隔，故以表头列位置切分
 * （中文表头 char index 因宽窄字符差略偏左，落点在空格带内，trim 后仍正确）。
 */
export function parseWindowsNetShare(raw: string): SmbShareRow[] {
  const out: SmbShareRow[] = []
  let resourceCol = -1
  let remarkCol = -1
  let inTable = false
  for (const line of raw.split(/\r?\n/)) {
    const t = line.replace(/\s+$/, '')
    if (!t.trim()) continue
    // 表头行（中/英文）：共享名 资源 备注 / Share name Resource Remark
    if (/共享名|share\s+name/i.test(t)) {
      inTable = true
      const cnRes = t.indexOf('资源')
      const cnRem = t.indexOf('备注')
      resourceCol = cnRes >= 0 ? cnRes : t.search(/resource/i)
      remarkCol = cnRem >= 0 ? cnRem : t.search(/remark/i)
      continue
    }
    // 结束行（中/英文）：命令成功完成 / The command completed successfully
    if (/命令成功完成|command completed/i.test(t)) {
      inTable = false
      continue
    }
    if (!inTable) continue
    if (/^-+$/.test(t)) continue
    if (resourceCol > 0) {
      const name = t.slice(0, adjustSplit(t, resourceCol)).trim()
      if (!name) continue
      const resCol = adjustSplit(t, resourceCol)
      const remCol = adjustSplit(t, remarkCol)
      const rest = t.slice(resCol)
      const hasRemark = remCol > resCol
      out.push({
        name,
        path: (hasRemark ? rest.slice(0, remCol - resCol) : rest).trim(),
        remark: hasRemark ? rest.slice(remCol - resCol).trim() : '',
      })
    } else {
      const m = t.trim().match(/^(\S+)\s+(.*\S)?\s*$/)
      if (m) out.push({ name: m[1], path: (m[2] ?? '').trim(), remark: '' })
    }
  }
  return out
}

/** 系统内置共享（管理共享以 $ 结尾），只展示不可删除 */
export function isHiddenShare(name: string): boolean {
  return name.endsWith('$')
}

/** Linux /etc/samba/smb.conf 解析：[段名] + path=，跳过 global/homes/printers/print$ */
export function parseLinuxSmbConf(raw: string): SmbShareRow[] {
  const SKIP = new Set(['global', 'homes', 'printers', 'print$'])
  const out: SmbShareRow[] = []
  let cur: SmbShareRow | null = null
  for (const line of raw.split(/\r?\n/)) {
    const section = line.match(/^\s*\[([^\]]+)\]\s*$/)
    if (section) {
      if (cur && !SKIP.has(cur.name)) out.push(cur)
      cur = { name: section[1].trim(), path: '', remark: '' }
      continue
    }
    if (!cur) continue
    const path = line.match(/^\s*path\s*=\s*(.+?)\s*$/)
    if (path) cur.path = path[1]
    const comment = line.match(/^\s*comment\s*=\s*(.+?)\s*$/)
    if (comment) cur.remark = comment[1]
  }
  if (cur && !SKIP.has(cur.name)) out.push(cur)
  return out
}

/** macOS `sharing -l` 输出解析：name:/path: 成对出现 */
export function parseMacSharingList(raw: string): SmbShareRow[] {
  const out: SmbShareRow[] = []
  let cur: SmbShareRow | null = null
  for (const line of raw.split(/\r?\n/)) {
    const name = line.match(/^name:\s*(.+?)\s*$/)
    if (name) {
      if (cur) out.push(cur)
      cur = { name: name[1], path: '', remark: '' }
      continue
    }
    const path = line.match(/^path:\s*(.+?)\s*$/)
    if (path && cur) cur.path = path[1]
  }
  if (cur) out.push(cur)
  return out
}

/** 跨平台统一分发（platform 来自 smb:list 返回） */
export function parseShareList(raw: string, platform: string): SmbShareRow[] {
  if (platform === 'win32') return parseWindowsNetShare(raw)
  if (platform === 'linux') return parseLinuxSmbConf(raw)
  if (platform === 'darwin') return parseMacSharingList(raw)
  return []
}

/** 由目录路径推断建议共享名（非法字符折叠为 -） */
export function suggestName(p: string): string {
  const base = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() ?? ''
  return base.replace(/[^a-zA-Z0-9_$-]/g, '-').slice(0, 80)
}
