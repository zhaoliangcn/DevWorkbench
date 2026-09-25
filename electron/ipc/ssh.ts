import { ipcMain } from 'electron'
import { NodeSSH } from 'node-ssh'

interface SSHConnectOptions {
  host: string
  port: number
  username: string
  password?: string
  privateKey?: string
}

// SSH 连接与 Shell 流管理（connectionId → 实例）
const sshConnections = new Map<string, NodeSSH>()
const sshStreams = new Map<unknown, { write: (d: string) => void; setWindow: (r: number, c: number) => void; destroy: () => void }>()

function registerSshIpc() {
  ipcMain.handle('ssh:connect', async (_event, connectionId: string, config: SSHConnectOptions) => {
    try {
      const ssh = new NodeSSH()

      await ssh.connect({
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 10000,
        ...(config.password ? { password: config.password } : {}),
        ...(config.privateKey ? { privateKey: config.privateKey } : {}),
      })
      sshConnections.set(connectionId, ssh)

      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('ssh:disconnect', async (_event, connectionId: string) => {
    try {
      const stream = sshStreams.get(connectionId)
      if (stream) {
        stream.destroy()
        sshStreams.delete(connectionId)
      }

      const ssh = sshConnections.get(connectionId)
      if (ssh) {
        ssh.dispose()
        sshConnections.delete(connectionId)
      }

      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('ssh:exec', async (_event, connectionId: string, command: string) => {
    try {
      const ssh = sshConnections.get(connectionId)
      if (!ssh) {
        return { success: false, error: '未建立连接' }
      }

      const result = await ssh.execCommand(command)
      return {
        success: true,
        stdout: result.stdout,
        stderr: result.stderr,
        code: result.code,
      }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('ssh:openShell', async (event, connectionId: string, cols: number, rows: number) => {
    try {
      const ssh = sshConnections.get(connectionId)
      if (!ssh) {
        event.sender.send('ssh:shellError', connectionId, '未建立连接')
        return { success: false }
      }

      const stream = await ssh.requestShell({
        cols,
        rows,
        term: 'xterm-256color',
      })

      if (!stream) {
        event.sender.send('ssh:shellError', connectionId, '无法打开 Shell')
        return { success: false }
      }

      sshStreams.set(connectionId, stream)

      stream.on('data', (data: Buffer) => {
        event.sender.send('ssh:shellData', connectionId, data.toString('utf-8'))
      })

      stream.on('error', (error: Error) => {
        event.sender.send('ssh:shellError', connectionId, error.message)
      })

      stream.on('close', () => {
        event.sender.send('ssh:shellClose', connectionId)
        sshStreams.delete(connectionId)
      })

      return { success: true }
    } catch (error) {
      event.sender.send('ssh:shellError', connectionId, (error as Error).message)
      return { success: false }
    }
  })

  ipcMain.handle('ssh:shellWrite', async (_event, connectionId: string, data: string) => {
    try {
      const stream = sshStreams.get(connectionId)
      if (!stream) {
        return { success: false, error: 'Shell 未打开' }
      }

      stream.write(data)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('ssh:shellResize', async (_event, connectionId: string, cols: number, rows: number) => {
    try {
      const stream = sshStreams.get(connectionId)
      if (!stream) {
        return { success: false }
      }

      stream.setWindow(rows, cols)
      return { success: true }
    } catch {
      return { success: false }
    }
  })
}

export { registerSshIpc }
