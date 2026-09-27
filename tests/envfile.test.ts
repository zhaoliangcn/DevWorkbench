// 附录 B.6.3：.env 管理器纯函数测试（解析/对比/生成/掩码）
import { describe, it, expect } from 'vitest'
import {
  parseEnvFile,
  diffEnvFiles,
  generateComposeEnv,
  generateEnvExample,
  maskValue,
} from '../src/workspaces/toolbox/tools/pure/envfile'

describe('parseEnvFile（B.6.3）', () => {
  it('基础解析：KEY=VALUE、export 前缀、引号剥离', () => {
    const { entries, duplicates } = parseEnvFile(
      [
        'DATABASE_URL=postgres://localhost:5432/app',
        'export API_KEY=abc123',
        'NAME="Hello World"',
        "SINGLE='v # not comment'",
        'EMPTY=',
      ].join('\n')
    )
    expect(entries).toEqual([
      { key: 'DATABASE_URL', value: 'postgres://localhost:5432/app', comment: '' },
      { key: 'API_KEY', value: 'abc123', comment: '' },
      { key: 'NAME', value: 'Hello World', comment: '' },
      { key: 'SINGLE', value: 'v # not comment', comment: '' },
      { key: 'EMPTY', value: '', comment: '' },
    ])
    expect(duplicates).toEqual([])
  })

  it('整行注释挂到下一键（跨空行），键后注释不串位', () => {
    const { entries } = parseEnvFile(
      ['# 服务端口', '# 第二行说明', '', 'PORT=3000', 'NOCOMMENT=1'].join('\n')
    )
    expect(entries[0].comment).toBe('服务端口\n第二行说明')
    expect(entries[1].comment).toBe('')
  })

  it('未加引号值的行内 # 注释剥离（要求前置空白）', () => {
    const { entries } = parseEnvFile(
      ['URL=https://x.com/#anchor', 'DEBUG=true # 开发模式', 'Q="a # b"'].join('\n')
    )
    expect(entries[0].value).toBe('https://x.com/#anchor') // URL hash 不剥
    expect(entries[1].value).toBe('true')
    expect(entries[2].value).toBe('a # b') // 引号内保留
  })

  it('重复键后值生效并记录，无法识别的行跳过', () => {
    const { entries, duplicates } = parseEnvFile(
      ['KEY=first', '这行不合法', 'KEY=second', '=novalue', '123BAD=x'].join('\n')
    )
    expect(duplicates).toEqual(['KEY'])
    expect(entries).toHaveLength(1)
    expect(entries[0].value).toBe('second')
  })
})

describe('diffEnvFiles（B.6.3）', () => {
  const f1 = parseEnvFile(['# 共享', 'A=1', 'B=x', 'C=only1'].join('\n'))
  const f2 = parseEnvFile(['A=1', 'B=y', 'D=only2'].join('\n'))

  it('键并集按出现顺序，缺失为 null，值不一致标记', () => {
    const diff = diffEnvFiles([
      { name: '.env.dev', parsed: f1 },
      { name: '.env.prod', parsed: f2 },
    ])
    expect(diff.files).toEqual(['.env.dev', '.env.prod'])
    expect(diff.rows.map((r) => r.key)).toEqual(['A', 'B', 'C', 'D'])
    expect(diff.rows[0]).toMatchObject({ values: ['1', '1'], inconsistent: false })
    expect(diff.rows[1]).toMatchObject({ values: ['x', 'y'], inconsistent: true })
    expect(diff.rows[2].values).toEqual(['only1', null])
    expect(diff.rows[3].values).toEqual([null, 'only2'])
    expect(diff.missingCounts).toEqual([1, 1])
    expect(diff.inconsistentCount).toBe(1)
    expect(diff.rows[0].comment).toBe('共享')
  })

  it('空对比返回空行', () => {
    const diff = diffEnvFiles([])
    expect(diff.rows).toEqual([])
    expect(diff.missingCounts).toEqual([])
  })
})

describe('generateComposeEnv / generateEnvExample（B.6.3）', () => {
  it('compose 环境段：environment: 下子项 +2 缩进（YAML 合法），可自定义', () => {
    const parsed = parseEnvFile('A=1\nB="hello world"')
    expect(generateComposeEnv(parsed)).toBe(
      ['  environment:', '    - A=1', '    - B=hello world'].join('\n')
    )
    expect(generateComposeEnv(parsed, 4).split('\n')[0]).toBe('    environment:')
  })

  it('example 模板：全键留空 + 注释保留 + 键间空行', () => {
    const parsed = parseEnvFile(['# 端口', 'PORT=3000', 'TOKEN=secret'].join('\n'))
    const diff = diffEnvFiles([{ name: '.env', parsed }])
    const text = generateEnvExample(diff)
    expect(text).toBe('# 端口\nPORT=\n\nTOKEN=\n')
  })
})

describe('maskValue（B.6.3）', () => {
  it('保留前 2 字符，其余掩码；空值原样', () => {
    expect(maskValue('abcdef')).toBe('ab****')
    expect(maskValue('ab')).toBe('ab***') // 短值最少 3 星
    expect(maskValue('')).toBe('')
  })
})
