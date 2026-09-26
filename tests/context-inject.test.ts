// C.5 进阶版测试：钉选上下文注入拼装（buildPinnedContext 纯函数）
import { describe, it, expect } from 'vitest'
import { buildPinnedContext, PREVIEW_CHARS } from '../src/workspaces/assistant/context-inject'

describe('buildPinnedContext', () => {
  it('无钉选笔记 → 原文直传，不注入任何包装', () => {
    const text = '你好'
    expect(buildPinnedContext([], text)).toBe(text)
  })

  it('单篇笔记：包含路径、预览、工具提示与用户问题分段', () => {
    const out = buildPinnedContext([{ path: 'notes/a.md', content: 'alpha beta' }], '总结一下')
    expect(out).toContain('【知识库钉选上下文】')
    expect(out).toContain('- notes/a.md')
    expect(out).toContain('预览: alpha beta')
    expect(out).toContain('knowledge_read_note')
    expect(out).toContain('【用户问题】\n总结一下')
    // 预览中换行被压平
    expect(out).not.toContain('预览: alpha\n')
  })

  it('多篇笔记逐条列出', () => {
    const out = buildPinnedContext(
      [
        { path: 'a.md', content: 'A' },
        { path: 'b.md', content: 'B' },
      ],
      'q',
    )
    expect(out).toContain('- a.md')
    expect(out).toContain('- b.md')
  })

  it('预览超长截断到 PREVIEW_CHARS 且空白压平', () => {
    const long = 'x'.repeat(2000) + '\n\n' + 'y'.repeat(2000)
    const out = buildPinnedContext([{ path: 'big.md', content: long }], 'q')
    const preview = out.split('预览: ')[1]?.split('\n')[0] ?? ''
    expect(preview.length).toBe(PREVIEW_CHARS)
    expect(preview).not.toContain('\n')
  })

  it('content 缺失时预览为空但不报错', () => {
    const out = buildPinnedContext([{ path: 'empty.md' }], 'q')
    expect(out).toContain('- empty.md')
    expect(out).toContain('预览: ')
  })
})
