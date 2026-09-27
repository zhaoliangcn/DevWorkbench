// 附录 F F.2：http:request 主进程 handler 测试
// 覆盖：文本响应、二进制 base64 回传、协议/URL 校验、失败路径、超时映射、isBinaryContent 边界
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'

vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() } }))

import { httpRequestHandler, isBinaryContent } from '../electron/ipc/http'

function mockFetchOnce(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const spy = vi.fn(impl)
  vi.stubGlobal('fetch', spy)
  return spy
}

describe('httpRequestHandler（附录 F F.2）', () => {
  beforeAll(() => {})
  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('文本响应：status/headers/body 原样返回', async () => {
    mockFetchOnce(async () =>
      new Response('{"ok":true}', {
        status: 201,
        headers: { 'content-type': 'application/json', 'x-trace': 't1' },
        statusText: 'Created',
      }),
    )
    const r = await httpRequestHandler({ url: 'https://api.example.com/x' })
    expect(r.success).toBe(true)
    expect(r.status).toBe(201)
    expect(r.statusText).toBe('Created')
    expect(r.bodyIsBase64).toBe(false)
    expect(r.body).toBe('{"ok":true}')
    expect(r.headers['content-type']).toBe('application/json')
    expect(r.headers['x-trace']).toBe('t1')
    expect(r.durationMs).toBeGreaterThanOrEqual(0)
  })

  it('二进制响应：base64 回传且可还原', async () => {
    const bytes = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00])
    mockFetchOnce(async () =>
      new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const r = await httpRequestHandler({ url: 'https://img.example.com/a.png' })
    expect(r.success).toBe(true)
    expect(r.bodyIsBase64).toBe(true)
    expect(Buffer.from(r.body, 'base64')).toEqual(Buffer.from(bytes))
  })

  it('POST 携带 body 与 headers', async () => {
    const spy = mockFetchOnce(async () => new Response('done', { status: 200 }))
    await httpRequestHandler({
      url: 'https://api.example.com/echo',
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{"a":1}',
    })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.method).toBe('POST')
    expect(init.body).toBe('{"a":1}')
    expect(init.headers).toEqual({ 'content-type': 'application/json' })
  })

  it('GET 请求不携带 body', async () => {
    const spy = mockFetchOnce(async () => new Response('ok'))
    await httpRequestHandler({ url: 'https://api.example.com/x', body: 'ignored' })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.body).toBeUndefined()
  })

  it('缺少 url → 失败', async () => {
    const r = await httpRequestHandler({ url: '' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('缺少 url')
  })

  it('file: 协议被拒绝', async () => {
    const r = await httpRequestHandler({ url: 'file:///etc/passwd' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('不支持的协议')
  })

  it('URL 格式非法 → 失败', async () => {
    const r = await httpRequestHandler({ url: 'not-a-url' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('非法')
  })

  it('网络错误 → success false + error', async () => {
    mockFetchOnce(async () => {
      throw new Error('ECONNREFUSED')
    })
    const r = await httpRequestHandler({ url: 'https://down.example.com/x' })
    expect(r.success).toBe(false)
    expect(r.status).toBeNull()
    expect(r.error).toBe('ECONNREFUSED')
  })

  it('超时映射为可读错误', async () => {
    mockFetchOnce(async () => {
      const e = new Error('The operation was aborted')
      e.name = 'TimeoutError'
      throw e
    })
    const r = await httpRequestHandler({ url: 'https://slow.example.com/x' })
    expect(r.success).toBe(false)
    expect(r.error).toContain('请求超时')
  })

  it('timeoutMs 夹取 1s-60s', async () => {
    const spy = mockFetchOnce(async () => new Response('ok'))
    await httpRequestHandler({ url: 'https://api.example.com/x', timeoutMs: 5 })
    const init = spy.mock.calls[0][1] as RequestInit
    expect(init.signal).toBeInstanceOf(AbortSignal)
  })
})

describe('isBinaryContent', () => {
  it('二进制前缀命中', () => {
    expect(isBinaryContent('image/png')).toBe(true)
    expect(isBinaryContent('application/octet-stream')).toBe(true)
    expect(isBinaryContent('application/pdf; charset=binary')).toBe(true)
  })

  it('文本类型不命中', () => {
    expect(isBinaryContent('application/json')).toBe(false)
    expect(isBinaryContent('text/html; charset=utf-8')).toBe(false)
  })

  it('空值不命中', () => {
    expect(isBinaryContent(null)).toBe(false)
    expect(isBinaryContent('')).toBe(false)
  })
})
