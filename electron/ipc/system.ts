import { ipcMain, app } from 'electron'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'
import net from 'node:net'
import os from 'node:os'
import https from 'node:https'
import http from 'node:http'

const execAsync = promisify(exec)

function registerSystemIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion())

  ipcMain.handle('app:getPlatform', () => ({
    platform: process.platform,
    arch: process.arch,
    homedir: os.homedir(),
  }))

  ipcMain.handle('system:checkEnv', async (_event, envType: string) => {
    const commands: Record<string, string> = {
      java: 'java -version 2>&1',
      python: 'python --version 2>&1 || python3 --version 2>&1',
      node: 'node --version 2>&1',
      go: 'go version 2>&1',
    }

    const command = commands[envType]
    if (!command) {
      return { name: envType, installed: false }
    }

    try {
      const { stdout } = await execAsync(command)
      return {
        name: envType,
        installed: true,
        version: stdout.trim(),
      }
    } catch {
      return { name: envType, installed: false }
    }
  })

  // host 缺省时检测本地端口占用（lsof/netstat）；提供 host 时做远程端口连通性探测
  ipcMain.handle('system:checkPort', async (_event, port: number, host?: string) => {
    if (host) {
      return new Promise<boolean>((resolve) => {
        const socket = new net.Socket()
        const timer = setTimeout(() => {
          socket.destroy()
          resolve(false)
        }, 1500)
        socket.connect(port, host, () => {
          clearTimeout(timer)
          socket.destroy()
          resolve(true)
        })
        socket.on('error', () => {
          clearTimeout(timer)
          resolve(false)
        })
      })
    }
    try {
      if (process.platform === 'darwin') {
        const { stdout } = await execAsync(`lsof -i :${port} -P -n`)
        const lines = stdout.split('\n').filter((line: string) => line.trim())
        if (lines.length > 1) {
          const parts = lines[1].split(/\s+/)
          return {
            port,
            protocol: 'TCP',
            pid: parseInt(parts[1]),
            processName: parts[0],
            state: 'LISTEN',
          }
        }
      } else if (process.platform === 'win32') {
        const { stdout } = await execAsync(`netstat -ano | findstr :${port}`)
        if (stdout) {
          const lines = stdout.split('\n').filter((line: string) => line.trim())
          const parts = lines[0].split(/\s+/)
          return {
            port,
            protocol: parts[0].toUpperCase(),
            pid: parseInt(parts[parts.length - 1]),
            state: parts[3],
          }
        }
      }
      return null
    } catch {
      return null
    }
  })

  ipcMain.handle('system:getLocalIps', () => {
    const ips: string[] = []
    for (const infos of Object.values(os.networkInterfaces())) {
      for (const info of infos ?? []) {
        if (info.family === 'IPv4' && !info.internal) {
          ips.push(info.address)
        }
      }
    }
    return ips
  })

  ipcMain.handle('system:killProcess', async (_event, pid: number) => {
    try {
      if (process.platform === 'win32') {
        await execAsync(`taskkill /F /PID ${pid}`)
      } else {
        await execAsync(`kill -9 ${pid}`)
      }
      return true
    } catch {
      return false
    }
  })

  ipcMain.handle('system:checkMirror', async (_event, url: string) => {
    try {
      const parsedUrl = new URL(url)
      const client = parsedUrl.protocol === 'https:' ? https : http

      return new Promise((resolve) => {
        const req = client.get(url, { timeout: 5000, method: 'HEAD' }, (res) => {
          resolve({
            url,
            available: res.statusCode !== undefined && res.statusCode < 400,
            statusCode: res.statusCode,
            responseTime: Date.now(),
          })
        })

        req.on('error', () => {
          resolve({
            url,
            available: false,
            statusCode: null,
            responseTime: Date.now(),
            error: '连接失败',
          })
        })

        req.on('timeout', () => {
          req.destroy()
          resolve({
            url,
            available: false,
            statusCode: null,
            responseTime: Date.now(),
            error: '请求超时',
          })
        })
      })
    } catch (error) {
      return {
        url,
        available: false,
        statusCode: null,
        responseTime: Date.now(),
        error: (error as Error).message,
      }
    }
  })
}

export { registerSystemIpc }
