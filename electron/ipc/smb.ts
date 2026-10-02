// SMB 共享管理（smb:* 命名空间）：Windows net share / Linux smb.conf / macOS sharing。
// 参照 docker.ts 模式：通道薄、创建删除走系统命令，列表返回原始输出由渲染层解析。
// 校验与 conf 段处理导出为纯函数（tests/smb.test.ts 直测）。
// 权限说明：win32 需管理员运行（net session 探测）；linux 走 pkexec（缺省回退 sudo）；
// darwin 走 sudo（无 TTY 时需已缓存凭据，失败则提示用户在系统设置配置共享）。
import { ipcMain, dialog } from 'electron'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const execAsync = promisify(exec)
const TIMEOUT = 20_000

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
  error?: string
}

/* ---------- Windows OEM 代码页解码 ----------
 * net share 等命令写管道时固定用 OEM 代码页（中文系统 936/GBK），
 * Node exec 默认 utf8 解码会乱码；chcp 65001 前缀实测无效，故按字节解码。
 * 代码页 → WHATWG TextDecoder 标签（Node 内置 full-icu 支持；不支持的标签回退 utf8，
 * ASCII 部分无损）。*/

const CODEPAGE_LABELS: Record<number, string> = {
  936: 'gbk',
  950: 'big5',
  932: 'shift_jis',
  949: 'euc-kr',
  874: 'windows-874',
  1250: 'windows-1250',
  1251: 'windows-1251',
  1252: 'windows-1252',
  1253: 'windows-1253',
  1254: 'windows-1254',
  1255: 'windows-1255',
  1256: 'windows-1256',
  1257: 'windows-1257',
}

/** 按代码页解码 Windows 命令输出（导出供测试） */
export function decodeWindowsText(buf: Buffer | undefined, codepage: number): string {
  if (!buf || buf.length === 0) return ''
  const label = CODEPAGE_LABELS[codepage]
  if (label) {
    try {
      return new TextDecoder(label).decode(buf)
    } catch {
      // 环境 ICU 不支持该标签时回退 utf8
    }
  }
  return buf.toString('utf-8')
}

/** chcp 查询 OEM 代码页（cmd 内建；输出语言随系统，仅提取数字）；模块级 memo */
let oemCodepageCache: number | null = null
async function getOemCodepage(): Promise<number> {
  if (oemCodepageCache !== null) return oemCodepageCache
  try {
    const { stdout } = await execAsync('chcp', { timeout: 5000 })
    const m = stdout.match(/(\d+)/)
    oemCodepageCache = m ? parseInt(m[1], 10) : 0
  } catch {
    oemCodepageCache = 0
  }
  return oemCodepageCache
}

async function runUnix(cmd: string): Promise<RunResult> {
  try {
    const { stdout, stderr } = await execAsync(cmd, { timeout: TIMEOUT, maxBuffer: 4 * 1024 * 1024 })
    return { ok: true, stdout, stderr }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '', error: e.message }
  }
}

async function runWindows(cmd: string): Promise<RunResult> {
  const cp = await getOemCodepage()
  try {
    const { stdout, stderr } = await execAsync(cmd, {
      timeout: TIMEOUT,
      maxBuffer: 4 * 1024 * 1024,
      encoding: 'buffer',
    })
    return { ok: true, stdout: decodeWindowsText(stdout as Buffer, cp), stderr: decodeWindowsText(stderr as Buffer, cp) }
  } catch (err) {
    const e = err as { stdout?: Buffer; stderr?: Buffer; message?: string }
    return {
      ok: false,
      stdout: decodeWindowsText(e.stdout, cp),
      stderr: decodeWindowsText(e.stderr, cp),
      error: e.message,
    }
  }
}

async function run(cmd: string): Promise<RunResult> {
  return process.platform === 'win32' ? runWindows(cmd) : runUnix(cmd)
}

function combineError(r: RunResult): string {
  return [r.error, r.stderr].filter(Boolean).join('\n').trim() || '未知错误'
}

/** POSIX 单引号转义（linux/darwin 分支使用） */
function shQuote(s: string): string {
  return `'` + s.replace(/'/g, `'\\''`) + `'`
}

/** Windows cmd 双引号包裹（调用方需先剔除内部双引号） */
function cmdQuote(s: string): string {
  return `"${s.replace(/"/g, '')}"`
}

/* ---------- 校验纯函数（导出供测试；主进程侧权威校验） ---------- */

/** 共享名：字母数字开头，允许 _ . - $，≤80 字符（Windows 上限），防命令注入 */
export function isSafeShareName(name: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.$-]{0,79}$/.test(name)
}

/** Windows 账户/组名（/GRANT 用）：允许字母数字 _ . 空格 - */
export function isSafeAccountName(name: string): boolean {
  return /^[a-zA-Z0-9_. -]{1,64}$/.test(name)
}

/** 共享路径：必须绝对路径，且不在系统敏感目录下（防误共享系统目录） */
export function isSafeSharePath(p: string): boolean {
  if (!p || p.length > 4096) return false
  if (/[\0"'\r\n]/.test(p)) return false
  // 绝对路径：盘符 / UNC / POSIX 根
  if (!/^([a-zA-Z]:[\\/]|\\\\|\/)/.test(p)) return false
  const forbidden = [
    process.env.SystemRoot,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
    process.env.ProgramData,
    'C:\\Windows',
    'C:\\Program Files',
    'C:\\ProgramData',
    '/etc',
    '/boot',
    '/sys',
    '/proc',
    '/dev',
    '/bin',
    '/sbin',
    '/usr',
    '/lib',
  ].filter(Boolean) as string[]
  const norm = p.toLowerCase().replace(/[\\/]+$/, '')
  return !forbidden.some((f) => {
    const nf = f.toLowerCase().replace(/[\\/]+$/, '')
    return norm === nf || norm.startsWith(nf + '/') || norm.startsWith(nf + '\\')
  })
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** 从 smb.conf 文本中移除指定共享段（[name] 行至下一个 [段] 或文件尾） */
export function removeSmbConfSection(conf: string, name: string): string {
  const re = new RegExp(`^\\s*\\[${escapeRegExp(name)}\\]\\s*$`)
  const out: string[] = []
  let skipping = false
  for (const line of conf.split(/\r?\n/)) {
    if (re.test(line)) {
      skipping = true
      continue
    }
    if (skipping && /^\s*\[.*\]\s*$/.test(line)) skipping = false
    if (!skipping) out.push(line)
  }
  return out.join('\n')
}

/** 构造 smb.conf 共享段文本（remark 折叠为单行防注入） */
export function buildSmbConfEntry(
  name: string,
  dir: string,
  remark: string | undefined,
  readonly: boolean | undefined,
  users: string | undefined,
): string {
  const lines = [`[${name}]`, `  path = ${dir}`]
  if (remark) lines.push(`  comment = ${remark.replace(/\r?\n/g, ' ')}`)
  lines.push('  browseable = yes')
  lines.push(readonly ? '  read only = yes' : '  writable = yes')
  if (users) lines.push(`  valid users = ${users}`)
  else lines.push('  guest ok = yes')
  return lines.join('\n') + '\n'
}

/** 非交互提权执行（linux 优先 pkexec 图形授权，缺省回退 sudo；darwin 直接 sudo） */
async function runPrivileged(cmd: string): Promise<RunResult> {
  if (process.platform === 'darwin') return run(`sudo ${cmd}`)
  const pk = await run('command -v pkexec')
  if (pk.ok && pk.stdout.trim()) return run(`pkexec sh -c ${shQuote(cmd)}`)
  return run(`sudo sh -c ${shQuote(cmd)}`)
}

function registerSmbIpc() {
  // 检测 SMB 管理能力 + 平台 + win32 管理员标记
  ipcMain.handle('smb:check', async () => {
    const platform = process.platform
    if (platform === 'win32') {
      const r = await run('net share')
      const admin = await run('net session')
      return {
        available: r.ok,
        platform,
        isAdmin: admin.ok,
        error: r.ok ? '' : combineError(r),
      }
    }
    if (platform === 'linux') {
      const r = await run('command -v smbd testparm 2>/dev/null')
      return {
        available: r.ok && r.stdout.trim().length > 0,
        platform,
        isAdmin: false,
        error: r.ok && r.stdout.trim() ? '' : '未安装 Samba（apt install samba / dnf install samba）',
      }
    }
    if (platform === 'darwin') {
      const r = await run('command -v sharing')
      return { available: r.ok && Boolean(r.stdout.trim()), platform, isAdmin: false, error: r.ok ? '' : '未找到 sharing 命令' }
    }
    return { available: false, platform: 'unknown', isAdmin: false, error: '不支持的平台' }
  })

  // 列出共享：返回原始输出，解析由渲染层 pure 层完成（可测试）
  ipcMain.handle('smb:list', async () => {
    const platform = process.platform
    if (platform === 'win32') {
      const r = await run('net share')
      return r.ok ? { success: true, raw: r.stdout, platform } : { success: false, raw: '', platform, error: combineError(r) }
    }
    if (platform === 'linux') {
      // smb.conf 通常全局可读，优先直接读；失败再提权读
      try {
        const raw = fs.readFileSync('/etc/samba/smb.conf', 'utf-8')
        return { success: true, raw, platform }
      } catch {
        const r = await runPrivileged('cat /etc/samba/smb.conf')
        return r.ok
          ? { success: true, raw: r.stdout, platform }
          : { success: false, raw: '', platform, error: combineError(r) }
      }
    }
    if (platform === 'darwin') {
      const r = await run('sharing -l')
      return r.ok ? { success: true, raw: r.stdout, platform } : { success: false, raw: '', platform, error: combineError(r) }
    }
    return { success: false, raw: '', platform, error: '不支持的平台' }
  })

  // 创建共享（一键核心入口）
  ipcMain.handle(
    'smb:create',
    async (
      _event,
      args: { name: string; path: string; remark?: string; readonly?: boolean; users?: string } | undefined,
    ) => {
      const name = args?.name ?? ''
      const dir = args?.path ?? ''
      if (!isSafeShareName(name)) return { success: false, error: '非法共享名（字母数字开头，允许 _ . - $，≤80 字符）' }
      if (!isSafeSharePath(dir)) return { success: false, error: '非法路径：须为绝对路径且不含引号，禁止系统敏感目录' }
      try {
        if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
          return { success: false, error: `路径不存在或不是目录: ${dir}` }
        }
      } catch (e) {
        return { success: false, error: `无法访问路径: ${(e as Error).message}` }
      }
      const users = (args?.users ?? '').trim()
      if (users) {
        for (const u of users.split(',')) {
          if (!isSafeAccountName(u.trim())) return { success: false, error: `非法账户名: ${u.trim()}` }
        }
      }

      const platform = process.platform
      if (platform === 'win32') {
        // /GRANT 支持逗号分隔多账户，逐个生成 GRANT 标志更稳妥
        const right = args?.readonly ? 'READ' : 'FULL'
        const grantList = users || 'Everyone'
        const grants = grantList
          .split(',')
          .map((u) => `/GRANT:${u.trim()},${right}`)
          .join(' ')
        const remarkPart = args?.remark ? ` /REMARK:${cmdQuote(args.remark.replace(/"/g, ''))}` : ''
        const r = await run(`net share ${name}=${cmdQuote(dir)} ${grants}${remarkPart}`)
        return r.ok ? { success: true } : { success: false, error: combineError(r) }
      }
      if (platform === 'linux') {
        const entry = buildSmbConfEntry(name, dir, args?.remark, args?.readonly, users)
        const tmp = path.join(os.tmpdir(), `dw-smb-${Date.now()}.conf`)
        try {
          fs.writeFileSync(tmp, entry, 'utf-8')
          const r = await runPrivileged(
            `cat ${shQuote(tmp)} >> /etc/samba/smb.conf && smbcontrol all reload-config`,
          )
          return r.ok ? { success: true } : { success: false, error: combineError(r) }
        } finally {
          fs.rmSync(tmp, { force: true })
        }
      }
      if (platform === 'darwin') {
        const r = await run(`sudo sharing -a ${shQuote(dir)}`)
        return r.ok ? { success: true } : { success: false, error: combineError(r) }
      }
      return { success: false, error: '不支持的平台' }
    },
  )

  // 删除共享（不删除实际目录）
  ipcMain.handle('smb:delete', async (_event, name: string) => {
    if (!isSafeShareName(name)) return { success: false, error: '非法共享名' }
    const platform = process.platform
    if (platform === 'win32') {
      const r = await run(`net share ${name} /DELETE /Y`)
      return r.ok ? { success: true } : { success: false, error: combineError(r) }
    }
    if (platform === 'linux') {
      // 读 conf（优先直接读）→ JS 移除段 → 备份 + 回写 + 重载
      let conf: string
      try {
        conf = fs.readFileSync('/etc/samba/smb.conf', 'utf-8')
      } catch {
        const r = await runPrivileged('cat /etc/samba/smb.conf')
        if (!r.ok) return { success: false, error: combineError(r) }
        conf = r.stdout
      }
      const next = removeSmbConfSection(conf, name)
      if (next === conf) return { success: false, error: `smb.conf 中未找到共享 [${name}]` }
      const tmp = path.join(os.tmpdir(), `dw-smb-${Date.now()}.conf`)
      try {
        fs.writeFileSync(tmp, next, 'utf-8')
        const r = await runPrivileged(
          `cp /etc/samba/smb.conf /etc/samba/smb.conf.bak && cat ${shQuote(tmp)} > /etc/samba/smb.conf && smbcontrol all reload-config`,
        )
        return r.ok ? { success: true } : { success: false, error: combineError(r) }
      } finally {
        fs.rmSync(tmp, { force: true })
      }
    }
    if (platform === 'darwin') {
      const r = await run(`sudo sharing -r ${shQuote(name)}`)
      return r.ok ? { success: true } : { success: false, error: combineError(r) }
    }
    return { success: false, error: '不支持的平台' }
  })

  // 目录选择对话框
  ipcMain.handle('smb:pickDir', async () => {
    const result = await dialog.showOpenDialog({
      title: '选择要共享的目录',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { success: true, canceled: true, path: '' }
    }
    return { success: true, canceled: false, path: result.filePaths[0] }
  })
}

export { registerSmbIpc }
