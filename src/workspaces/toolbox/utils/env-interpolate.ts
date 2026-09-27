// 环境变量插值引擎（附录 F F.1）—— 纯函数，Postman-lite 的 {{var}} 支持。
// 规则：{{key}} 单值；{{env.key}} 一层嵌套（env 是字典名，实际取 variables.key）；
// 未知变量原样保留并收集到 missing[]，供 UI 高亮提示。

export interface InterpolateResult {
  result: string
  /** 未命中定义的变量名（保持原文出现在结果里） */
  missing: string[]
}

const VAR_PATTERN = /\{\{\s*([^}]+?)\s*\}\}/g

/**
 * 对文本做 {{var}} 插值。
 * @param text 原文（可为空串）
 * @param variables 变量字典
 */
export function interpolateVariables(text: string, variables: Record<string, string>): InterpolateResult {
  if (!text) return { result: text, missing: [] }
  const missing = new Set<string>()

  const result = text.replace(VAR_PATTERN, (raw, name: string) => {
    // {{env.key}} 与 {{key}} 同义（一层嵌套字典，不递归）
    const key = name.startsWith('env.') ? name.slice(4) : name
    const value = variables[key]
    if (value === undefined) {
      missing.add(name.trim())
      return raw // 未知变量原样保留
    }
    return value
  })

  return { result, missing: [...missing] }
}

/**
 * 对请求的三段（url/headers/body）统一插值，返回插值后的请求片段与缺失变量合集。
 */
export function interpolateRequest(
  url: string,
  headers: Record<string, string>,
  body: string,
  variables: Record<string, string>,
): { url: string; headers: Record<string, string>; body: string; missing: string[] } {
  const u = interpolateVariables(url, variables)
  const b = interpolateVariables(body, variables)
  const newHeaders: Record<string, string> = {}
  const missing = new Set<string>([...u.missing, ...b.missing])
  for (const [k, v] of Object.entries(headers)) {
    const kh = interpolateVariables(k, variables)
    const vh = interpolateVariables(v, variables)
    newHeaders[kh.result] = vh.result
    kh.missing.forEach((m) => missing.add(m))
    vh.missing.forEach((m) => missing.add(m))
  }
  return { url: u.result, headers: newHeaders, body: b.result, missing: [...missing] }
}

/** 断言校验（附录 F F.1）：响应后逐条执行，返回每条断言的通过情况 */
export interface AssertionResult {
  id: string
  pass: boolean
  /** 实际值（用于 UI 展示 diff） */
  actual: string
}

export function runAssertions(
  assertions: import('../../../types/toolbox').ApiAssertion[],
  ctx: { status: number; headers: Record<string, string>; body: string; timeMs: number },
): AssertionResult[] {
  return assertions.map((a) => {
    let actual = ''
    // header 断言约定：expected 编码为 "key=value"（唯一同时需要键与值的类型）
    let headerCmp: { op: string; expected: string | number } | null = null
    switch (a.type) {
      case 'status':
        actual = String(ctx.status)
        break
      case 'header': {
        const s = String(a.expected)
        const eq = s.indexOf('=')
        const key = eq === -1 ? s : s.slice(0, eq)
        const want = eq === -1 ? '' : s.slice(eq + 1)
        actual = ctx.headers[key.trim().toLowerCase()] ?? ''
        headerCmp = { op: eq === -1 ? 'contains' : a.op, expected: want }
        break
      }
      case 'bodyContains':
        actual = ctx.body
        break
      case 'jsonPath': {
        // 最小 jsonPath：$.a.b.c 逐层取值（数组下标 a.0.b）；expected 存路径，期望值在 expectedValue
        try {
          let cur: unknown = JSON.parse(ctx.body)
          for (const seg of String(a.expected).replace(/^\$\.?/, '').split('.')) {
            if (cur === null || cur === undefined) break
            cur = (cur as Record<string, unknown>)[seg]
          }
          actual = cur === undefined ? '' : String(cur)
        } catch {
          actual = ''
        }
        break
      }
      case 'timeMs':
        actual = String(ctx.timeMs)
        break
    }
    const cmp =
      a.type === 'jsonPath'
        ? { op: a.op, expected: a.expectedValue ?? '' }
        : headerCmp ?? { op: a.op, expected: a.expected }
    // jsonPath 未配置期望值时断言无意义，一律判失败
    if (a.type === 'jsonPath' && a.expectedValue === undefined) {
      return { id: a.id, pass: false, actual }
    }
    return { id: a.id, pass: compare(cmp.op, cmp.expected, actual, a.type), actual }
  })
}

function compare(op: string, expected: string | number, actual: string, type: string): boolean {
  if (type === 'bodyContains' || type === 'header') {
    if (op === 'eq') return actual === String(expected)
    if (op === 'contains') return actual.includes(String(expected))
    if (op === 'matches') {
      try {
        return new RegExp(String(expected)).test(actual)
      } catch {
        return false
      }
    }
    return false
  }
  if (type === 'timeMs' || type === 'status') {
    const e = Number(expected)
    const a = Number(actual)
    if (Number.isNaN(e) || Number.isNaN(a)) return false
    if (op === 'eq') return a === e
    if (op === 'gt') return a > e
    if (op === 'lt') return a < e
    return false
  }
  // jsonPath
  if (op === 'eq') return actual === String(expected)
  if (op === 'contains') return actual.includes(String(expected))
  if (op === 'matches') {
    try {
      return new RegExp(String(expected)).test(actual)
    } catch {
      return false
    }
  }
  return false
}
