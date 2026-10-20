// 程序员计算器纯逻辑引擎（tokenizer + 递归下降解析器）。
// 替代旧版 Function() 动态求值：消除代码注入面与 2^53 精度丢失，
// 全程 BigInt，中间结果按字长 wrap（补码位模式，模拟固定宽度寄存器）。
// 运算符优先级对齐 Windows 计算器：
//   ~  >  * / %  >  + -  >  << >>  >  AND  >  XOR  >  OR
// 除法/取模/右移按符号性区分：signed 按补码真值运算，unsigned 按位模式。

export type CalcBase = 2 | 8 | 10 | 16
export type CalcBits = 8 | 16 | 32 | 64

export interface CalcOptions {
  /** 数字字面量解析进制 */
  base: CalcBase
  /** 寄存器字长 */
  bits: CalcBits
  /** 有符号（影响 DEC 显示与除法/取模/右移语义） */
  signed: boolean
}

export interface CalcSuccess {
  ok: true
  /** wrap 后的无符号位模式值 */
  value: bigint
  dec: string
  hex: string
  oct: string
  bin: string
}

export interface CalcFailure {
  ok: false
  error: string
}

export type CalcOutput = CalcSuccess | CalcFailure

const DIGITS = '0123456789abcdef'
const MAX_SHIFT = 1024n

class CalcError extends Error {}

// ---------- 字长工具 ----------

function bitWidth(bits: CalcBits): bigint {
  return 1n << BigInt(bits)
}

/** wrap 到字长内的无符号位模式（BigInt 补码语义天然取模） */
function wrap(v: bigint, bits: CalcBits): bigint {
  return v & (bitWidth(bits) - 1n)
}

/** 无符号位模式 → 补码真值 */
function toSigned(v: bigint, bits: CalcBits): bigint {
  const half = 1n << BigInt(bits - 1)
  return v >= half ? v - bitWidth(bits) : v
}

// ---------- Tokenizer ----------

type Token = { kind: 'num'; value: bigint } | { kind: 'op'; value: string }

const KEYWORD_OPS: Record<string, string> = { AND: '&', OR: '|', XOR: '^', NOT: '~' }
const PREFIX_BASES: Record<string, number> = { x: 16, b: 2, o: 8 }
const TWO_CHAR_OPS = ['<<', '>>']
const ONE_CHAR_OPS = '+-*/%()~&|^'

function digitVal(ch: string): number {
  return DIGITS.indexOf(ch.toLowerCase())
}

function readNumber(src: string, start: number, base: number): { value: bigint; next: number } {
  let next = start
  let value = 0n
  while (next < src.length) {
    const d = digitVal(src[next])
    if (d < 0 || d >= base) break
    value = value * BigInt(base) + BigInt(d)
    next++
  }
  return { value, next }
}

export function tokenize(src: string, base: CalcBase): Token[] {
  const tokens: Token[] = []
  let i = 0
  while (i < src.length) {
    const ch = src[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    // 关键字 AND/OR/XOR/NOT（优先于字母位，避免 HEX 下 "AND" 被误读为数字）
    const kw = Object.keys(KEYWORD_OPS).find((k) => src.slice(i).toUpperCase().startsWith(k))
    if (kw) {
      tokens.push({ kind: 'op', value: KEYWORD_OPS[kw] })
      i += kw.length
      continue
    }
    // 0x / 0b / 0o 显式前缀字面量（任意进制下可用）
    if (ch === '0' && /[xbo]/i.test(src[i + 1] ?? '')) {
      const pbase = PREFIX_BASES[src[i + 1].toLowerCase()]
      const { value, next } = readNumber(src, i + 2, pbase)
      if (next === i + 2) throw new CalcError(`"${src.slice(i, i + 2)}" 后缺少有效数字`)
      tokens.push({ kind: 'num', value })
      i = next
      continue
    }
    // 按当前进制解析数字（字母位仅当进制允许，如 HEX 下的 A-F）
    const d = digitVal(ch)
    if (d >= 0 && d < base) {
      const { value, next } = readNumber(src, i, base)
      tokens.push({ kind: 'num', value })
      i = next
      continue
    }
    const two = src.slice(i, i + 2)
    if (TWO_CHAR_OPS.includes(two)) {
      tokens.push({ kind: 'op', value: two })
      i += 2
      continue
    }
    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ kind: 'op', value: ch })
      i++
      continue
    }
    throw new CalcError(`无效字符 "${ch}"`)
  }
  return tokens
}

// ---------- 递归下降解析器 ----------

class Parser {
  private pos = 0

  constructor(private tokens: Token[], private opts: CalcOptions) {}

  parse(): bigint {
    if (this.tokens.length === 0) throw new CalcError('表达式为空')
    const v = this.parseOr()
    if (this.pos < this.tokens.length) throw new CalcError('表达式存在多余内容')
    return v
  }

  private peek(): Token | undefined {
    return this.tokens[this.pos]
  }

  private matchOp(...ops: string[]): string | null {
    const t = this.peek()
    if (t && t.kind === 'op' && ops.includes(t.value)) {
      this.pos++
      return t.value
    }
    return null
  }

  // 优先级从低到高：OR < XOR < AND < 移位 < 加减 < 乘除模 < 一元 < 括号/数字
  private parseOr(): bigint {
    let left = this.parseXor()
    while (this.matchOp('|')) left = wrap(left | this.parseXor(), this.opts.bits)
    return left
  }

  private parseXor(): bigint {
    let left = this.parseAnd()
    while (this.matchOp('^')) left = wrap(left ^ this.parseAnd(), this.opts.bits)
    return left
  }

  private parseAnd(): bigint {
    let left = this.parseShift()
    while (this.matchOp('&')) left = wrap(left & this.parseShift(), this.opts.bits)
    return left
  }

  private parseShift(): bigint {
    let left = this.parseAdd()
    for (;;) {
      const op = this.matchOp('<<', '>>')
      if (!op) return left
      const right = this.parseAdd()
      const sRight = toSigned(right, this.opts.bits)
      if (sRight < 0n) throw new CalcError('移位数不能为负')
      if (sRight > MAX_SHIFT) throw new CalcError('移位数过大')
      left =
        op === '<<'
          ? wrap(left << sRight, this.opts.bits)
          : this.shiftRight(left, sRight)
    }
  }

  private shiftRight(v: bigint, n: bigint): bigint {
    // 有符号为算术右移（补码符号位填充），无符号为逻辑右移
    return wrap(this.opts.signed ? toSigned(v, this.opts.bits) >> n : v >> n, this.opts.bits)
  }

  private parseAdd(): bigint {
    let left = this.parseMul()
    for (;;) {
      const op = this.matchOp('+', '-')
      if (!op) return left
      const right = this.parseMul()
      left = wrap(op === '+' ? left + right : left - right, this.opts.bits)
    }
  }

  private parseMul(): bigint {
    let left = this.parseUnary()
    for (;;) {
      const op = this.matchOp('*', '/', '%')
      if (!op) return left
      const right = this.parseUnary()
      left = wrap(this.applyMul(left, op, right), this.opts.bits)
    }
  }

  private applyMul(a: bigint, op: string, b: bigint): bigint {
    if (op === '*') return a * b
    if (b === 0n) throw new CalcError('除数为零')
    // signed 按补码真值运算：BigInt 的 / 向零取整、% 余数符号随被除数（对齐 C 语义）
    const x = this.opts.signed ? toSigned(a, this.opts.bits) : a
    const y = this.opts.signed ? toSigned(b, this.opts.bits) : b
    return op === '/' ? x / y : x % y
  }

  private parseUnary(): bigint {
    if (this.matchOp('~')) return wrap(~this.parseUnary(), this.opts.bits)
    if (this.matchOp('-')) return wrap(-this.parseUnary(), this.opts.bits)
    if (this.matchOp('+')) return this.parseUnary()
    return this.parsePrimary()
  }

  private parsePrimary(): bigint {
    if (this.matchOp('(')) {
      const v = this.parseOr()
      if (!this.matchOp(')')) throw new CalcError('括号不匹配')
      return v
    }
    const t = this.peek()
    if (t && t.kind === 'num') {
      this.pos++
      return wrap(t.value, this.opts.bits)
    }
    throw new CalcError('表达式不完整')
  }
}

// ---------- 对外入口 ----------

/** 按字长/符号格式化四进制显示文本 */
export function formatValue(
  v: bigint,
  opts: Pick<CalcOptions, 'bits' | 'signed'>,
): { dec: string; hex: string; oct: string; bin: string } {
  const dec = (opts.signed ? toSigned(v, opts.bits) : v).toString(10)
  const hex = v.toString(16).toUpperCase().padStart(opts.bits / 4, '0')
  const bin = v.toString(2).padStart(opts.bits, '0').replace(/\B(?=(.{4})+$)/g, ' ')
  return { dec, hex, oct: v.toString(8), bin }
}

export function evalExpr(expr: string, opts: CalcOptions): CalcOutput {
  try {
    const tokens = tokenize(expr, opts.base)
    const value = new Parser(tokens, opts).parse()
    return { ok: true, value, ...formatValue(value, opts) }
  } catch (e) {
    return { ok: false, error: e instanceof CalcError ? e.message : '表达式无效' }
  }
}

// ---------- 进制切换时的字面量转换（UI 联动用） ----------

/**
 * 将表达式中按 from 进制可解析的数字字面量重写为 to 进制，其余字符原样保留。
 * 支持 0x/0b/0o 前缀，关键字 AND/OR/XOR/NOT 不受影响。
 * 无法解析的片段（如 DEC 下误入的字母）保持原样，不抛错。
 */
export function convertLiterals(expr: string, from: CalcBase, to: CalcBase): string {
  if (!expr) return ''
  let out = ''
  let i = 0
  while (i < expr.length) {
    const ch = expr[i]
    if (!/[0-9a-z]/i.test(ch)) {
      out += ch
      i++
      continue
    }
    // 关键字优先（大小写不敏感，输出统一大写形式）
    const rest = expr.slice(i).toUpperCase()
    const kw = Object.keys(KEYWORD_OPS).find((k) => rest.startsWith(k))
    if (kw) {
      out += kw
      i += kw.length
      continue
    }
    // 数字 run：识别可选前缀后按源进制读取
    let j = i
    let pbase: number = from
    if (expr[j] === '0' && PREFIX_BASES[(expr[j + 1] ?? '').toLowerCase()] !== undefined) {
      pbase = PREFIX_BASES[expr[j + 1].toLowerCase()]
      j += 2
    }
    const start = j
    while (j < expr.length) {
      const d = digitVal(expr[j])
      if (d < 0 || d >= pbase) break
      j++
    }
    if (j > start) {
      let value = 0n
      for (let k = start; k < j; k++) {
        value = value * BigInt(pbase) + BigInt(digitVal(expr[k]))
      }
      out += value.toString(to).toUpperCase()
      i = j
    } else {
      // 无法解析的字符（如 DEC 下误入的字母）原样保留
      out += expr[i]
      i++
    }
  }
  return out
}
