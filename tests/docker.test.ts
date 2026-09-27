// 附录 B.6.1：Docker 面板纯函数测试（CLI --format json 输出解析）
import { describe, it, expect } from 'vitest'
import {
  parseDockerJsonLines,
  toContainerRows,
  toImageRows,
} from '../src/workspaces/toolbox/tools/pure/docker'

const CONTAINER_LINE = JSON.stringify({
  ID: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
  Names: '/web-nginx',
  Image: 'nginx:latest',
  State: 'running',
  Status: 'Up 2 hours',
  Ports: '0.0.0.0:8080->80/tcp',
  CreatedAt: '2026-09-27 10:00:00 +0800 CST',
})

const IMAGE_LINE = JSON.stringify({
  Repository: 'redis',
  Tag: '7-alpine',
  ID: 'sha256:deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  CreatedSince: '3 days ago',
  Size: '40.2MB',
})

describe('parseDockerJsonLines（B.6.1）', () => {
  it('逐行解析 JSON 对象', () => {
    const raw = `${CONTAINER_LINE}\n${CONTAINER_LINE.replace('web-nginx', 'api')}`
    const rows = parseDockerJsonLines(raw)
    expect(rows).toHaveLength(2)
    expect(rows[0].Names).toBe('/web-nginx')
    expect(rows[1].Names).toBe('/api')
  })

  it('跳过空行与坏行（warning 混入 stdout）', () => {
    const raw = `WARNING: some docker warning\n\n${CONTAINER_LINE}\nnot-json{broken\n`
    const rows = parseDockerJsonLines(raw)
    expect(rows).toHaveLength(1)
    expect(rows[0].Image).toBe('nginx:latest')
  })

  it('JSON 数组与标量行被忽略', () => {
    const raw = `[1,2]\n"str"\n42\n${CONTAINER_LINE}`
    expect(parseDockerJsonLines(raw)).toHaveLength(1)
  })

  it('空输入返回空数组', () => {
    expect(parseDockerJsonLines('')).toEqual([])
  })
})

describe('toContainerRows（B.6.1）', () => {
  it('字段映射：ID 截 12 位、Names 去前导斜杠', () => {
    const [row] = toContainerRows(CONTAINER_LINE)
    expect(row.id).toBe('a1b2c3d4e5f6')
    expect(row.name).toBe('web-nginx')
    expect(row.image).toBe('nginx:latest')
    expect(row.state).toBe('running')
    expect(row.status).toBe('Up 2 hours')
    expect(row.ports).toBe('0.0.0.0:8080->80/tcp')
    expect(row.createdAt).toBe('2026-09-27 10:00:00 +0800 CST')
  })

  it('缺失字段回退空串不抛错', () => {
    const [row] = toContainerRows(JSON.stringify({ ID: 'short123' }))
    expect(row).toMatchObject({ id: 'short123', name: '', state: '' })
  })
})

describe('toImageRows（B.6.1）', () => {
  it('字段映射：ID 去 sha256: 前缀并截 12 位', () => {
    const [row] = toImageRows(IMAGE_LINE)
    expect(row.repository).toBe('redis')
    expect(row.tag).toBe('7-alpine')
    expect(row.id).toBe('deadbeefdead')
    expect(row.created).toBe('3 days ago')
    expect(row.size).toBe('40.2MB')
  })

  it('CreatedSince 缺失时回退 CreatedAt', () => {
    const [row] = toImageRows(JSON.stringify({ Repository: 'a', CreatedAt: '2026-09-01' }))
    expect(row.created).toBe('2026-09-01')
  })
})
