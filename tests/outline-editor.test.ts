import { describe, it, expect } from 'vitest'
import { extractHeadings, readingStats } from '../src/workspaces/knowledge/utils/outline'
import { arrayBufferToBase64, mimeFromPath } from '../src/workspaces/knowledge/utils/image'

describe('extractHeadings', () => {
  it('收集各级标题并按文档序号编 id', () => {
    const hs = extractHeadings('# 一\n正文\n## 二\n### 三')
    expect(hs).toEqual([
      { level: 1, text: '一', id: 'h-0' },
      { level: 2, text: '二', id: 'h-1' },
      { level: 3, text: '三', id: 'h-2' },
    ])
  })

  it('代码块内的 # 不算标题（跳过围栏）', () => {
    const hs = extractHeadings('# 真标题\n```\n# 假标题\n```\n~~~\n## 波浪围栏也不算\n~~~')
    expect(hs).toEqual([{ level: 1, text: '真标题', id: 'h-0' }])
  })

  it('#7 与无空格 #tag 不算标题', () => {
    expect(extractHeadings('####### 七级\n#标签\n正文')).toEqual([])
  })

  it('列表内的 # 不算标题（非行首）', () => {
    expect(extractHeadings('- # 列表内\n正文')).toEqual([])
  })

  it('空串与无标题返回空数组', () => {
    expect(extractHeadings('')).toEqual([])
    expect(extractHeadings('普通正文\n没有标题')).toEqual([])
  })

  it('标题文本去首尾空白', () => {
    expect(extractHeadings('#  空白标题  ')[0].text).toBe('空白标题')
  })
})

describe('readingStats', () => {
  it('去空白计数 + 阅读时长至少 1 分钟', () => {
    expect(readingStats('a b\n#c')).toEqual({ chars: 4, minutes: 1 })
    expect(readingStats('x'.repeat(401)).minutes).toBe(2)
    expect(readingStats('')).toEqual({ chars: 0, minutes: 1 })
  })
})

describe('arrayBufferToBase64', () => {
  it('小 buffer 精确编码', () => {
    // 'hello' 的 UTF-8 字节
    expect(arrayBufferToBase64(new TextEncoder().encode('hello').buffer as ArrayBuffer)).toBe(
      btoa('hello')
    )
  })

  it('大 buffer 分块编码与一次性编码一致（> 32KB 触发分块）', () => {
    const bytes = new Uint8Array(0x8000 + 17)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i % 251
    const buffer = bytes.buffer as ArrayBuffer
    // 与分块逻辑等价的直接期望：atob 往返校验
    const decoded = new Uint8Array(
      atob(arrayBufferToBase64(buffer))
        .split('')
        .map((c) => c.charCodeAt(0)),
    )
    expect([...decoded]).toEqual([...bytes])
  })

  it('空 buffer 返回空串', () => {
    expect(arrayBufferToBase64(new ArrayBuffer(0))).toBe('')
  })
})

describe('mimeFromPath', () => {
  it('按扩展名推断', () => {
    expect(mimeFromPath('attachments/a.jpg')).toBe('image/jpeg')
    expect(mimeFromPath('attachments/a.JPEG')).toBe('image/jpeg')
    expect(mimeFromPath('attachments/a.gif')).toBe('image/gif')
    expect(mimeFromPath('attachments/a.webp')).toBe('image/webp')
    expect(mimeFromPath('attachments/a.svg')).toBe('image/svg+xml')
    expect(mimeFromPath('attachments/a.png')).toBe('image/png')
    expect(mimeFromPath('attachments/a.unknown')).toBe('image/png')
  })
})
