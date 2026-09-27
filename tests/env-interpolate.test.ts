// 附录 F F.1：环境变量插值 + 断言校验测试
// 覆盖：{{var}} 单值/嵌套 env. 前缀、未知变量原样保留并收集、$ 不误判、
// 请求三段统一插值、断言（status/header/bodyContains/jsonPath/timeMs）
import { describe, it, expect } from 'vitest'
import { interpolateVariables, interpolateRequest, runAssertions } from '../src/workspaces/toolbox/utils/env-interpolate'
import type { ApiAssertion } from '../src/types/toolbox'

describe('interpolateVariables', () => {
  it('单值插值', () => {
    const r = interpolateVariables('https://{{host}}/api', { host: 'api.dev.com' })
    expect(r.result).toBe('https://api.dev.com/api')
    expect(r.missing).toEqual([])
  })

  it('env. 前缀等价于直接取键（一层嵌套）', () => {
    const r = interpolateVariables('{{env.token}}', { token: 'sk-abc' })
    expect(r.result).toBe('sk-abc')
  })

  it('未知变量原样保留并收集到 missing', () => {
    const r = interpolateVariables('/u/{{unknown}}/{{host}}', { host: 'h' })
    expect(r.result).toBe('/u/{{unknown}}/h')
    expect(r.missing).toEqual(['unknown'])
  })

  it('变量名两侧空白可容忍', () => {
    const r = interpolateVariables('{{ host }}', { host: 'h' })
    expect(r.result).toBe('h')
  })

  it('$ 符号不被误判为特殊替换', () => {
    // 值含 $&、$1 等 replace 特殊序列时必须原样输出
    const r = interpolateVariables('{{x}}', { x: '$& $1 $$' })
    expect(r.result).toBe('$& $1 $$')
  })

  it('空文本直接返回', () => {
    const r = interpolateVariables('', { host: 'h' })
    expect(r.result).toBe('')
    expect(r.missing).toEqual([])
  })

  it('重复未知变量去重', () => {
    const r = interpolateVariables('{{a}}-{{a}}', {})
    expect(r.missing).toEqual(['a'])
  })
})

describe('interpolateRequest', () => {
  it('url/headers/body 三段统一插值', () => {
    const r = interpolateRequest(
      'https://{{host}}/login',
      { Authorization: 'Bearer {{token}}' },
      '{"user": "{{env.name}}"}',
      { host: 'api.dev.com', token: 't1', name: 'ada' },
    )
    expect(r.url).toBe('https://api.dev.com/login')
    expect(r.headers['Authorization']).toBe('Bearer t1')
    expect(r.body).toBe('{"user": "ada"}')
    expect(r.missing).toEqual([])
  })

  it('缺失变量跨三段去重汇总', () => {
    const r = interpolateRequest(
      '/{{a}}',
      { 'X-{{b}}': 'v' },
      '{{c}}',
      {},
    )
    expect(r.missing.sort()).toEqual(['a', 'b', 'c'])
  })
})

describe('runAssertions', () => {
  const ctx = {
    status: 201,
    headers: { 'content-type': 'application/json', 'x-id': '42' },
    body: '{"data":{"id":7,"name":"ada"},"list":[10,20]}',
    timeMs: 350,
  }

  it('status 断言 eq/gt/lt', () => {
    const as: ApiAssertion[] = [
      { id: '1', type: 'status', op: 'eq', expected: 201 },
      { id: '2', type: 'status', op: 'gt', expected: 200 },
      { id: '3', type: 'status', op: 'lt', expected: 300 },
      { id: '4', type: 'status', op: 'eq', expected: 200 },
    ]
    const r = runAssertions(as, ctx)
    expect(r.map((x) => x.pass)).toEqual([true, true, true, false])
  })

  it('header 断言：expected 编码 key=value，键大小写不敏感', () => {
    const as: ApiAssertion[] = [
      { id: '1', type: 'header', op: 'eq', expected: 'Content-Type=application/json' },
      { id: '2', type: 'header', op: 'contains', expected: 'x-id=4' },
    ]
    const r = runAssertions(as, ctx)
    expect(r.map((x) => x.pass)).toEqual([true, true])
  })

  it('bodyContains 断言', () => {
    const as: ApiAssertion[] = [{ id: '1', type: 'bodyContains', op: 'contains', expected: '"id":7' }]
    expect(runAssertions(as, ctx)[0].pass).toBe(true)
  })

  it('jsonPath 断言：逐层取值 + 数组下标（expected 存路径，expectedValue 存期望值）', () => {
    const as: ApiAssertion[] = [
      { id: '1', type: 'jsonPath', op: 'eq', expected: '$.data.id', expectedValue: 7 },
      { id: '2', type: 'jsonPath', op: 'eq', expected: '$.list.1', expectedValue: 20 },
      { id: '3', type: 'jsonPath', op: 'eq', expected: '$.data.missing', expectedValue: 'x' },
    ]
    const r = runAssertions(as, ctx)
    expect(r[0].pass).toBe(true)
    expect(r[1].actual).toBe('20')
    expect(r[1].pass).toBe(true)
    expect(r[2].pass).toBe(false)
  })

  it('timeMs 断言上限', () => {
    const as: ApiAssertion[] = [{ id: '1', type: 'timeMs', op: 'lt', expected: 500 }]
    expect(runAssertions(as, ctx)[0].pass).toBe(true)
  })

  it('畸形 JSON 时 jsonPath 不抛错，判失败', () => {
    const as: ApiAssertion[] = [{ id: '1', type: 'jsonPath', op: 'eq', expected: '$.a' }]
    const r = runAssertions(as, { ...ctx, body: 'not json' })
    expect(r[0].pass).toBe(false)
  })

  it('非法正则 matches 判失败不抛错', () => {
    const as: ApiAssertion[] = [{ id: '1', type: 'bodyContains', op: 'matches', expected: '([bad' }]
    expect(runAssertions(as, ctx)[0].pass).toBe(false)
  })
})
