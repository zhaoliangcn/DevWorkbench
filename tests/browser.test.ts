import { describe, expect, it } from 'vitest'
import {
  channelAttemptSequence,
  compactText,
  normalizeUrl,
  toPngDataUrl,
  truncateText,
  validateSelector,
} from '../src/workspaces/toolbox/tools/pure/browser'

describe('channelAttemptSequence', () => {
  it('顺序为 msedge → chrome → chromium', () => {
    expect(channelAttemptSequence()).toEqual(['msedge', 'chrome', 'chromium'])
  })
})

describe('normalizeUrl', () => {
  it('无协议自动补 https://', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/')
  })

  it('保留已有 http/https 协议', () => {
    expect(normalizeUrl('http://example.com/a?b=1')).toBe('http://example.com/a?b=1')
    expect(normalizeUrl('https://example.com')).toBe('https://example.com/')
  })

  it('拒绝非 http(s) 协议与空输入', () => {
    expect(normalizeUrl('file:///C:/Windows')).toBeNull()
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('ftp://example.com')).toBeNull()
    expect(normalizeUrl('')).toBeNull()
    expect(normalizeUrl('   ')).toBeNull()
  })

  it('拒绝无法解析的字符串', () => {
    expect(normalizeUrl('http://')).toBeNull()
  })
})

describe('compactText', () => {
  it('压缩连续空行并去掉行尾空白', () => {
    expect(compactText('a  \n\n\n\nb\t\n')).toBe('a\n\nb')
  })

  it('trim 首尾并处理空输入', () => {
    expect(compactText('\n\n x \n\n')).toBe('x')
    expect(compactText('')).toBe('')
  })
})

describe('truncateText', () => {
  it('不超长原样返回', () => {
    expect(truncateText('abc', 10)).toBe('abc')
    expect(truncateText('12345', 5)).toBe('12345')
  })

  it('超长截断并带省略号', () => {
    expect(truncateText('abcdefg', 5)).toBe('ab...')
    expect(truncateText('abcdefg', 7)).toBe('abcdefg')
  })

  it('边界 maxLen', () => {
    expect(truncateText('abc', 0)).toBe('')
    expect(truncateText('abc', 3)).toBe('abc')
  })
})

describe('toPngDataUrl', () => {
  it('合法 base64 组装 dataURL', () => {
    expect(toPngDataUrl('aGVsbG8=')).toBe('data:image/png;base64,aGVsbG8=')
  })

  it('拒绝非法输入', () => {
    expect(toPngDataUrl('')).toBeNull()
    expect(toPngDataUrl('not valid!!')).toBeNull()
  })
})

describe('validateSelector', () => {
  it('合法选择器返回 null', () => {
    expect(validateSelector('#submit')).toBeNull()
    expect(validateSelector('div > a.link')).toBeNull()
  })

  it('空与超长返回错误消息', () => {
    expect(validateSelector('')).toContain('不能为空')
    expect(validateSelector('   ')).toContain('不能为空')
    expect(validateSelector('a'.repeat(501))).toContain('过长')
  })
})
