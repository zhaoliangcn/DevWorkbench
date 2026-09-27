/**
 * .env 文件解析与多文件对比（附录 B.6.3）。
 * 纯函数层：解析/差异/生成 compose 环境段/.env.example 模板/值掩码。
 * dotenv 语义子集：KEY=VALUE、export 前缀、整行 # 注释（挂到下一键）、
 * 单双引号剥离、未加引号值的行内 # 注释剥离、重复键后者生效并记录。
 */

export interface EnvEntry {
  key: string
  value: string
  /** 键上方最近的整行注释（多行合并，# 前缀已剥离） */
  comment: string
}

export interface EnvFileParsed {
  entries: EnvEntry[]
  /** 重复键列表（后值生效） */
  duplicates: string[]
}

const KEY_RE = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/

/** 剥离值两侧成对引号（仅当首尾匹配时） */
function unquote(v: string): string {
  if (v.length >= 2) {
    const first = v[0]
    if ((first === '"' || first === "'") && v[v.length - 1] === first) {
      return v.slice(1, -1)
    }
  }
  return v
}

export function parseEnvFile(raw: string): EnvFileParsed {
  const entries: EnvEntry[] = []
  const duplicates: string[] = []
  const indexByKey = new Map<string, number>()
  let pendingComment = ''

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue // 空行不截断注释归属（注释块持续挂到下一键）
    if (line.startsWith('#')) {
      const text = line.replace(/^#+\s*/, '')
      pendingComment = pendingComment ? `${pendingComment}\n${text}` : text
      continue
    }
    const m = KEY_RE.exec(line)
    if (!m) {
      pendingComment = '' // 无法识别的行也截断注释
      continue
    }
    let value = m[2].trim()
    // 未加引号的值：行内 # 之后视为注释（前面必有空白，避免剥掉 URL hash）
    const isQuoted = value.length >= 2 && (value[0] === '"' || value[0] === "'")
    if (!isQuoted) {
      const hash = value.search(/\s#/)
      if (hash !== -1) value = value.slice(0, hash).trim()
    }
    value = unquote(value)

    const key = m[1]
    const existing = indexByKey.get(key)
    if (existing !== undefined) {
      entries[existing] = { key, value, comment: pendingComment }
      if (!duplicates.includes(key)) duplicates.push(key)
    } else {
      indexByKey.set(key, entries.length)
      entries.push({ key, value, comment: pendingComment })
    }
    pendingComment = ''
  }

  return { entries, duplicates }
}

/* ---------- 多文件对比 ---------- */

export interface EnvDiffRow {
  key: string
  comment: string
  /** 与 files 下标对应；null 表示该文件缺失此键 */
  values: (string | null)[]
  /** 存在于所有文件但值不一致 */
  inconsistent: boolean
}

export interface EnvDiff {
  files: string[]
  rows: EnvDiffRow[]
  /** 每个文件缺失键数（下标与 files 对应） */
  missingCounts: number[]
  inconsistentCount: number
}

/**
 * 多文件键级对比：行序 = 各文件键出现顺序的并集（先到先得）。
 * 同键注释取第一个非空。
 */
export function diffEnvFiles(files: { name: string; parsed: EnvFileParsed }[]): EnvDiff {
  const names = files.map((f) => f.name)
  const keyOrder: string[] = []
  const seen = new Set<string>()
  const comments = new Map<string, string>()
  const maps = files.map((f) => {
    const map = new Map<string, string>()
    for (const e of f.parsed.entries) {
      map.set(e.key, e.value)
      if (!seen.has(e.key)) {
        seen.add(e.key)
        keyOrder.push(e.key)
        if (e.comment) comments.set(e.key, e.comment)
      } else if (!comments.has(e.key) && e.comment) {
        comments.set(e.key, e.comment)
      }
    }
    return map
  })

  const rows: EnvDiffRow[] = keyOrder.map((key) => {
    const values = maps.map((m) => m.get(key) ?? null)
    const present = values.every((v) => v !== null)
    const inconsistent =
      present && new Set(values.map((v) => v as string)).size > 1
    return { key, comment: comments.get(key) ?? '', values, inconsistent }
  })

  const missingCounts = names.map(
    (_, i) => rows.filter((r) => r.values[i] === null).length
  )
  const inconsistentCount = rows.filter((r) => r.inconsistent).length

  return { files: names, rows, missingCounts, inconsistentCount }
}

/* ---------- 生成片段 ---------- */

/** 由单个文件的解析结果生成 docker-compose environment 段（含真实值） */
export function generateComposeEnv(parsed: EnvFileParsed, indent = 2): string {
  const pad = ' '.repeat(indent)
  const lines = [`${pad}environment:`]
  for (const e of parsed.entries) {
    lines.push(`${pad}  - ${e.key}=${e.value}`)
  }
  return lines.join('\n')
}

/** 由多文件对比生成 .env.example 模板：全部键名，值留空，保留注释 */
export function generateEnvExample(diff: EnvDiff): string {
  const lines: string[] = []
  for (const row of diff.rows) {
    if (row.comment) {
      for (const c of row.comment.split('\n')) lines.push(`# ${c}`)
    }
    lines.push(`${row.key}=`)
    lines.push('')
  }
  // 去掉末尾多余空行
  while (lines.length && lines[lines.length - 1] === '') lines.pop()
  return lines.join('\n') + '\n'
}

/** 展示用掩码：保留前 2 字符，其余以 *** 替代（空值原样显示） */
export function maskValue(value: string): string {
  if (!value) return ''
  const head = value.slice(0, 2)
  return `${head}${'*'.repeat(Math.max(3, value.length - 2))}`
}
