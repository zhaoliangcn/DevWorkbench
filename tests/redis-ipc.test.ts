// 附录 F F.5：Redis 客户端测试（命令解析 + 回复序列化 + IPC 流程，ioredis mock）
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

/* ---------- electron ipcMain.handle 捕获（vi.hoisted 防提升引用错误） ---------- */

const electronMocks = vi.hoisted(() => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  return { handlers }
})

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, fn: (...args: unknown[]) => unknown) => {
      electronMocks.handlers.set(channel, fn)
    }),
  },
}))

/* ---------- ioredis mock ---------- */

const redisMocks = vi.hoisted(() => {
  const connectMock = vi.fn()
  const pingMock = vi.fn()
  const infoMock = vi.fn()
  const callMock = vi.fn()
  const scanMock = vi.fn()
  const quitMock = vi.fn()
  const disconnectMock = vi.fn()
  class MockRedis {
    connect = connectMock
    ping = pingMock
    info = infoMock
    call = callMock
    scan = scanMock
    quit = quitMock
    disconnect = disconnectMock
    constructor(public opts: Record<string, unknown>) {}
  }
  return { MockRedis, connectMock, pingMock, infoMock, callMock, scanMock, quitMock, disconnectMock }
})

vi.mock('ioredis', () => ({ default: redisMocks.MockRedis }))

import { parseRedisCommand, serializeReply, registerRedisIpc } from '../electron/ipc/redis'

const invoke = (channel: string, ...args: unknown[]) =>
  electronMocks.handlers.get(channel)!(null, ...args) as Promise<Record<string, unknown>>

beforeAll(() => {
  registerRedisIpc()
})

afterAll(() => {
  vi.clearAllMocks()
})

describe('parseRedisCommand（命令行解析）', () => {
  it('简单命令按空白切分', () => {
    expect(parseRedisCommand('GET mykey')).toEqual(['GET', 'mykey'])
  })

  it('双引号参数允许空格', () => {
    expect(parseRedisCommand('SET "hello world" 1')).toEqual(['SET', 'hello world', '1'])
  })

  it('支持 \\" 转义', () => {
    expect(parseRedisCommand('SET key "say \\"hi\\""')).toEqual(['SET', 'key', 'say "hi"'])
  })

  it('多余空白可容忍；空串返回空数组', () => {
    expect(parseRedisCommand('  GET    k  ')).toEqual(['GET', 'k'])
    expect(parseRedisCommand('')).toEqual([])
    expect(parseRedisCommand('   ')).toEqual([])
  })

  it('引号未闭合抛错', () => {
    expect(() => parseRedisCommand('SET "abc')).toThrow('引号未闭合')
  })
})

describe('serializeReply（回复归一化）', () => {
  it('Buffer → utf8 字符串', () => {
    expect(serializeReply(Buffer.from('redis值'))).toBe('redis值')
  })

  it('嵌套数组递归归一化', () => {
    expect(serializeReply(['a', ['b', Buffer.from('c')], 3, null])).toEqual(['a', ['b', 'c'], 3, null])
  })

  it('超长字符串截断并带标记', () => {
    const out = serializeReply('x'.repeat(64 * 1024 + 10)) as string
    expect(out.length).toBeLessThan(64 * 1024 + 100)
    expect(out).toContain('截断')
  })
})

describe('IPC 流程（ioredis mock）', () => {
  it('connect：PING 通过并解析版本', async () => {
    redisMocks.connectMock.mockResolvedValueOnce(undefined)
    redisMocks.pingMock.mockResolvedValueOnce('PONG')
    redisMocks.infoMock.mockResolvedValueOnce('# Server\nredis_version:7.2.4\nos:Linux')
    const r = await invoke('redis:connect', { id: 'c1', host: 'localhost', port: 6379 })
    expect(r.success).toBe(true)
    expect(r.version).toBe('7.2.4')
  })

  it('connect：连接失败返回 error 且不残留实例', async () => {
    redisMocks.connectMock.mockRejectedValueOnce(new Error('ECONNREFUSED 127.0.0.1:6379'))
    const r = await invoke('redis:connect', { id: 'c2', host: '127.0.0.1', port: 6379 })
    expect(r.success).toBe(false)
    expect(r.error).toContain('ECONNREFUSED')
    const exec = await invoke('redis:exec', 'c2', 'PING')
    expect(exec.success).toBe(false)
  })

  it('exec：未连接直接报错', async () => {
    const r = await invoke('redis:exec', 'no-such', 'GET k')
    expect(r.success).toBe(false)
    expect(r.error).toContain('未建立')
  })

  it('exec：命令大写化后透传 client.call', async () => {
    redisMocks.callMock.mockResolvedValueOnce('v1')
    const r = await invoke('redis:exec', 'c1', 'get mykey')
    expect(redisMocks.callMock).toHaveBeenCalledWith('GET', 'mykey')
    expect(r.success).toBe(true)
    expect(r.value).toBe('v1')
  })

  it('exec：空命令报错', async () => {
    const r = await invoke('redis:exec', 'c1', '   ')
    expect(r.success).toBe(false)
    expect(r.error).toContain('空命令')
  })

  it('scan：透传 cursor/match/count 并返回键数组', async () => {
    redisMocks.scanMock.mockResolvedValueOnce(['17', ['app:user:1', 'app:order:2']])
    const r = await invoke('redis:scan', 'c1', '0', 'app:*', 100)
    expect(redisMocks.scanMock).toHaveBeenCalledWith('0', 'MATCH', 'app:*', 'COUNT', 100)
    expect(r.cursor).toBe('17')
    expect(r.keys).toEqual(['app:user:1', 'app:order:2'])
  })

  it('disconnect：quit 后连接移除', async () => {
    const r = await invoke('redis:disconnect', 'c1')
    expect(r.success).toBe(true)
    const exec = await invoke('redis:exec', 'c1', 'PING')
    expect(exec.success).toBe(false)
  })
})
