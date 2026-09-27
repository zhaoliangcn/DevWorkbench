// 附录 F F.3：Webhook 接收器测试
// 覆盖：ringPush 环形 buffer（保序/超限丢最旧/不可变/默认容量）+ createWebhookHandler（404/204/200/413/CORS）
import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import type { IncomingMessage, ServerResponse } from 'node:http'

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: vi.fn(() => []) },
}))

import {
  ringPush,
  createWebhookHandler,
  WEBHOOK_BUFFER_MAX,
  WEBHOOK_BODY_LIMIT,
  type WebhookEvent,
} from '../electron/ipc/webhook'

/* ---------- 测试用 fake req/res ---------- */

function createReq(method: string, url: string, headers: Record<string, string> = {}) {
  const req = new EventEmitter() as IncomingMessage & EventEmitter
  req.method = method
  req.url = url
  Object.assign(req, { headers })
  return req
}

function createRes() {
  const res = {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: '',
    writableEnded: false,
    setHeader: vi.fn((key: string, value: string) => {
      res.headers[key.toLowerCase()] = value
    }),
    end: vi.fn((data?: string) => {
      res.writableEnded = true
      if (data) res.body = data
    }),
  }
  return res as unknown as ServerResponse & {
    headers: Record<string, string>
    body: string
    end: ReturnType<typeof vi.fn>
  }
}

/* ---------- ringPush ---------- */

describe('ringPush（附录 F F.3 环形 buffer）', () => {
  it('未超限：保序追加', () => {
    expect(ringPush([1, 2], 3, 5)).toEqual([1, 2, 3])
  })

  it('超限：丢弃最旧，保留最新 max 条', () => {
    expect(ringPush([1, 2, 3], 4, 3)).toEqual([2, 3, 4])
  })

  it('恰好等于容量：全部保留', () => {
    expect(ringPush([1, 2], 3, 3)).toEqual([1, 2, 3])
  })

  it('不可变：原数组不受影响', () => {
    const buf = [1, 2, 3]
    const next = ringPush(buf, 4, 3)
    expect(buf).toEqual([1, 2, 3])
    expect(next).not.toBe(buf)
  })

  it('默认容量 WEBHOOK_BUFFER_MAX = 100', () => {
    expect(WEBHOOK_BUFFER_MAX).toBe(100)
    let buf: number[] = []
    for (let i = 0; i < 105; i++) buf = ringPush(buf, i)
    expect(buf.length).toBe(100)
    expect(buf[0]).toBe(5)
    expect(buf[buf.length - 1]).toBe(104)
  })

  it('WEBHOOK_BODY_LIMIT 为 1MB', () => {
    expect(WEBHOOK_BODY_LIMIT).toBe(1024 * 1024)
  })
})

/* ---------- createWebhookHandler ---------- */

describe('createWebhookHandler（附录 F F.3 路由 handler）', () => {
  it('未启用：404 且不回调 onEvent', () => {
    const onEvent = vi.fn()
    const handler = createWebhookHandler({ isEnabled: () => false, onEvent })
    const req = createReq('POST', '/webhook/test')
    const res = createRes()
    handler(req, res)
    req.emit('end')
    expect(res.statusCode).toBe(404)
    expect(JSON.parse(res.body).error).toContain('未启用')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('CORS 全开：响应头三个字段', () => {
    const handler = createWebhookHandler({ isEnabled: () => false, onEvent: vi.fn() })
    const res = createRes()
    handler(createReq('GET', '/x'), res)
    expect(res.headers['access-control-allow-origin']).toBe('*')
    expect(res.headers['access-control-allow-methods']).toContain('OPTIONS')
    expect(res.headers['access-control-allow-headers']).toBe('*')
  })

  it('启用 + OPTIONS 预检：204 空响应', () => {
    const handler = createWebhookHandler({ isEnabled: () => true, onEvent: vi.fn() })
    const req = createReq('OPTIONS', '/webhook/test')
    const res = createRes()
    handler(req, res)
    expect(res.statusCode).toBe(204)
    expect(res.body).toBe('')
  })

  it('启用 + POST：onEvent 收到事件，200 返回 {received, id}', () => {
    const events: WebhookEvent[] = []
    const handler = createWebhookHandler({ isEnabled: () => true, onEvent: (ev) => events.push(ev) })
    const req = createReq('POST', '/webhook/test?a=1', { 'content-type': 'application/json', 'x-sign': 'abc' })
    const res = createRes()
    handler(req, res)
    req.emit('data', Buffer.from('{"a":1'))
    req.emit('data', Buffer.from(',"b":2}'))
    req.emit('end')

    expect(res.statusCode).toBe(200)
    const parsed = JSON.parse(res.body)
    expect(parsed.received).toBe(true)
    expect(events).toHaveLength(1)
    expect(events[0].method).toBe('POST')
    expect(events[0].path).toBe('/webhook/test?a=1')
    expect(events[0].headers['x-sign']).toBe('abc')
    expect(events[0].body).toBe('{"a":1,"b":2}')
    expect(typeof events[0].receivedAt).toBe('number')
    expect(parsed.id).toBe(events[0].id)
  })

  it('body 超限：413 且后续 end 不触发 onEvent', () => {
    const onEvent = vi.fn()
    const handler = createWebhookHandler({ isEnabled: () => true, onEvent, bodyLimit: 8 })
    const req = createReq('POST', '/webhook/big')
    const res = createRes()
    handler(req, res)
    req.emit('data', Buffer.from('1234567890'))
    req.emit('end')

    expect(res.statusCode).toBe(413)
    expect(JSON.parse(res.body).error).toContain('上限')
    expect(onEvent).not.toHaveBeenCalled()
  })

  it('小写方法统一转大写；GET 无 body 为空字符串', () => {
    const events: WebhookEvent[] = []
    const handler = createWebhookHandler({ isEnabled: () => true, onEvent: (ev) => events.push(ev) })
    const req = createReq('get', '/webhook/ping')
    const res = createRes()
    handler(req, res)
    req.emit('end')
    expect(events[0].method).toBe('GET')
    expect(events[0].body).toBe('')
  })
})
