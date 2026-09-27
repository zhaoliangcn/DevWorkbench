import { describe, it, expect } from 'vitest'
import { renderTemplate, todayStr, TEMPLATE_DIR, DEFAULT_DAILY_TEMPLATE } from '../src/workspaces/knowledge/utils/template'

describe('renderTemplate 占位符替换', () => {
  it('{{date}} 与 {{title}} 全局替换', () => {
    const out = renderTemplate(
      '# {{title}}\n日期 {{date}}，再次 {{date}}，标题再提 {{title}}',
      { title: '2026-09-27', date: '2026-09-27' },
    )
    expect(out).toBe('# 2026-09-27\n日期 2026-09-27，再次 2026-09-27，标题再提 2026-09-27')
  })

  it('未知占位符原样保留', () => {
    expect(renderTemplate('{{time}} {{date}}', { title: 'T', date: 'D' })).toBe('{{time}} D')
  })

  it('替换值含 $ 不产生替换注入', () => {
    expect(renderTemplate('{{title}}', { title: '$&$`$\'', date: '' })).toBe('$&$`$\'')
  })

  it('无占位符原样返回', () => {
    const tpl = '普通内容 #标签 [[链接]]'
    expect(renderTemplate(tpl, { title: 'x', date: 'y' })).toBe(tpl)
  })

  it('空模板返回空串', () => {
    expect(renderTemplate('', { title: 'x', date: 'y' })).toBe('')
  })
})

describe('todayStr 与常量', () => {
  it('todayStr 为本地时区 YYYY-MM-DD 格式', () => {
    expect(todayStr()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('TEMPLATE_DIR 带尾斜杠便于 startsWith', () => {
    expect(TEMPLATE_DIR).toBe('templates/')
    expect(`${TEMPLATE_DIR}daily.md`.startsWith(TEMPLATE_DIR)).toBe(true)
  })

  it('内置每日模板同时演示两个占位符', () => {
    const out = renderTemplate(DEFAULT_DAILY_TEMPLATE, { title: '2026-09-27', date: '2026-09-27' })
    expect(out).not.toContain('{{')
    expect(out).toContain('# 2026-09-27')
  })
})
