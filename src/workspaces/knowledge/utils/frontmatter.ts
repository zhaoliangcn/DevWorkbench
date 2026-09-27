import { extractTags } from './markdown'

export interface Frontmatter {
  /** frontmatter 中声明的 tags（去引号、剥前导 # 后） */
  tags: string[]
  /** frontmatter 中声明的 aliases */
  aliases: string[]
  /** frontmatter 中声明的 created（原样字符串，不做日期解析） */
  created: string | null
  /** frontmatter 中声明的 status（附录 B.5.2 看板视图用，如 todo/doing/done） */
  status: string | null
  /** 围栏闭合行之后的正文起始偏移；无 frontmatter 时为 0 */
  end: number
}

const EMPTY: Frontmatter = { tags: [], aliases: [], created: null, status: null, end: 0 }

/** 去成对引号，再剥标签的前导 #（容错 tags: [#a]） */
function cleanValue(raw: string): string {
  const s = raw.trim()
  const quoted = s.match(/^["'](.*)["']$/)
  return (quoted ? quoted[1] : s).replace(/^#/, '')
}

/** 列表值：`[a, b]` 行内数组；无括号标量按逗号切分（宽松处理） */
function parseListValue(value: string): string[] {
  const bracket = value.match(/^\[(.*)\]$/)
  const source = bracket ? bracket[1] : value
  return source
    .split(',')
    .map(cleanValue)
    .filter(Boolean)
}

/**
 * 最小 YAML 子集解析（附录 E E.3.3）：仅支持 `---` 围栏 + `key: value`，
 * 只认 tags/aliases/created 三键，列表支持 `[a, b]` 行内数组与 `- a` 多行列表。
 * 围栏必须从首行开始且闭合，否则整篇视为正文（Obsidian 同规则）；不引 gray-matter。
 */
export function parseFrontmatter(content: string): Frontmatter {
  const lines = content.split('\n')
  if (lines[0].trim() !== '---') return EMPTY

  // 找闭合围栏行，同时累计偏移（+1 为 split 吃掉的换行；CRLF 的 \r 留在行内由 trim 处理）
  let offset = lines[0].length + 1
  let bodyLines: string[] | null = null
  let end = 0
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      bodyLines = lines.slice(1, i)
      end = offset + lines[i].length + 1
      break
    }
    offset += lines[i].length + 1
  }
  if (!bodyLines) return EMPTY // 围栏未闭合：不当作 frontmatter

  const result: Frontmatter = { tags: [], aliases: [], created: null, status: null, end }
  let currentListKey: 'tags' | 'aliases' | null = null

  for (const rawLine of bodyLines) {
    const line = rawLine.trim()
    if (!line) continue

    // `- value` 列表项：归属最近一个值为空的键
    const listItem = line.match(/^-\s+(.+)$/)
    if (listItem && currentListKey) {
      result[currentListKey].push(cleanValue(listItem[1]))
      continue
    }
    currentListKey = null

    const kv = line.match(/^([\w-]+):\s*(.*)$/)
    if (!kv) continue
    const [, key, rawValue] = kv
    const value = rawValue.trim()

    if (key === 'tags' || key === 'aliases') {
      if (!value) {
        currentListKey = key // 值在后续 `-` 行
      } else {
        result[key] = parseListValue(value)
      }
    } else if (key === 'created') {
      result.created = cleanValue(value) || null
    } else if (key === 'status') {
      result.status = cleanValue(value) || null
    }
    // 其余键忽略
  }
  return result
}

/**
 * 写回/删除 frontmatter 单键（附录 B.5.2 看板拖拽用）：纯函数不引库。
 * - 无 frontmatter 且 value 非 null：在文件头生成围栏
 * - 键已存在：原位替换（value 为 null 则整行删除）
 * - 键不存在且 value 非 null：在闭合围栏前插入
 * key 限 `[\w-]+`，value 强制单行（换行符替换为空格），防注入围栏。
 */
export function updateFrontmatterKey(content: string, key: string, value: string | null): string {
  if (!/^[\w-]+$/.test(key)) return content
  const cleanValueText = value === null ? null : value.replace(/[\r\n]+/g, ' ').trim()
  const lines = content.split('\n')

  if (lines[0].trim() !== '---') {
    if (cleanValueText === null) return content
    return ['---', `${key}: ${cleanValueText}`, '---', '', ...lines].join('\n')
  }

  // 找闭合围栏行
  let closeIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      closeIdx = i
      break
    }
  }
  if (closeIdx < 0) return content // 围栏未闭合：不写回（与 parse 同规则）

  const body = lines.slice(1, closeIdx)
  const keyPattern = new RegExp(`^${key}\\s*:`)
  let replaced = false
  const nextBody: string[] = []
  for (const line of body) {
    if (keyPattern.test(line.trim())) {
      replaced = true
      if (cleanValueText !== null) nextBody.push(`${key}: ${cleanValueText}`)
      // value null：删除该行（不入 nextBody）
    } else {
      nextBody.push(line)
    }
  }
  if (!replaced && cleanValueText !== null) {
    nextBody.push(`${key}: ${cleanValueText}`)
  }

  return ['---', ...nextBody, '---', ...lines.slice(closeIdx + 1)].join('\n')
}

/**
 * 全量标签提取（附录 E E.3.3）：frontmatter tags 优先 + 剥离围栏后的正文行内 #标签，
 * 合并去重（保序）。note.tags 的唯一来源，store 三处写入点均走此函数。
 */
export function extractAllTags(content: string): string[] {
  const fm = parseFrontmatter(content)
  const inline = extractTags(content.slice(fm.end))
  return [...new Set([...fm.tags, ...inline])]
}
