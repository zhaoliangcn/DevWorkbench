import { ipcMain } from 'electron'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
const TIMEOUT = 10_000

/** 容器/镜像 ID 白名单（字母数字开头，允许 _ . -），防命令注入 */
export function isSafeDockerId(id: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(id)
}

async function runDocker(args: string): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  try {
    // --format 用双引号包裹：内部 {{json .}} 无 shell 特殊字符，darwin/win32 通用
    const { stdout, stderr } = await execAsync(`docker ${args}`, {
      timeout: TIMEOUT,
      maxBuffer: 8 * 1024 * 1024,
    })
    return { ok: true, stdout, stderr }
  } catch (err) {
    // docker logs 走 stderr；非零退出时 exec 也会带出已产出的流
    const e = err as { stderr?: string; stdout?: string; message?: string }
    return { ok: false, stdout: e.stdout ?? '', stderr: e.stderr ?? '', error: e.message }
  }
}

function registerDockerIpc() {
  ipcMain.handle('docker:check', async () => {
    const r = await runDocker("version --format '{{.Server.Version}}'")
    if (r.ok) return { available: true, version: r.stdout.trim() }
    return { available: false, error: r.error }
  })

  // 通道保持薄：返回原始格式化输出，解析由 renderer pure 层完成（可测试）
  ipcMain.handle('docker:containers', async () => {
    const r = await runDocker('ps -a --format "{{json .}}"')
    if (!r.ok) return { success: false, raw: '', error: r.error }
    return { success: true, raw: r.stdout }
  })

  ipcMain.handle('docker:images', async () => {
    const r = await runDocker('images --format "{{json .}}"')
    if (!r.ok) return { success: false, raw: '', error: r.error }
    return { success: true, raw: r.stdout }
  })

  // docker logs 输出在 stderr，两者合并返回
  ipcMain.handle('docker:logs', async (_event, id: string, tail: number) => {
    if (!isSafeDockerId(id)) return { success: false, logs: '', error: '非法容器 ID' }
    const n = Number.isFinite(tail) && tail > 0 ? Math.min(Math.floor(tail), 5000) : 200
    const r = await runDocker(`logs --tail ${n} ${id}`)
    if (!r.ok && !r.stdout && !r.stderr) return { success: false, logs: '', error: r.error }
    return { success: true, logs: (r.stdout + r.stderr).trim() }
  })

  ipcMain.handle('docker:action', async (_event, action: string, id: string) => {
    const allowed = ['start', 'stop', 'restart', 'remove'] as const
    if (!(allowed as readonly string[]).includes(action) || !isSafeDockerId(id)) {
      return { success: false, error: '非法操作或容器 ID' }
    }
    const r = await runDocker(`${action}${action === 'remove' ? ' -f' : ''} ${id}`)
    return r.ok ? { success: true } : { success: false, error: r.error }
  })
}

export { registerDockerIpc }
