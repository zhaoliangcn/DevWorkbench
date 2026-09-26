// 进制转换纯函数（切片 G，设计 C.3）。
// 与主进程 electron/ipc/assistant-tools.ts 的 toolbox_radix 成对实现
// （electron tsconfig rootDir 限制无法共享源码，两侧均保持极薄）。
//
// 相比 parseInt 的三点修正：
// 1. 完整串校验（parseInt('1a',10) 会静默返回 1）
// 2. BigInt 运算无 2^53 精度丢失
// 3. 支持负号前缀

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyz'

export interface RadixInput {
  value: string
  fromBase: number
  toBase: number
}

export interface RadixOutput {
  result: string
  error?: string
}

export function radixConvert(input: RadixInput): RadixOutput {
  const { value: raw, fromBase, toBase } = input
  const value = raw.trim()

  if (!Number.isInteger(fromBase) || fromBase < 2 || fromBase > 36) {
    return { result: '', error: '源进制必须在 2-36 之间' }
  }
  if (!Number.isInteger(toBase) || toBase < 2 || toBase > 36) {
    return { result: '', error: '目标进制必须在 2-36 之间' }
  }
  if (!value) {
    return { result: '', error: '无效的输入' }
  }

  let body = value
  let sign = ''
  if (body.startsWith('-')) {
    sign = '-'
    body = body.slice(1)
  }
  if (!body) {
    return { result: '', error: '无效的输入' }
  }

  let n = 0n
  for (const ch of body.toLowerCase()) {
    const d = DIGITS.indexOf(ch)
    if (d < 0 || d >= fromBase) {
      return { result: '', error: `无效的输入：字符 "${ch}" 不是 ${fromBase} 进制位` }
    }
    n = n * BigInt(fromBase) + BigInt(d)
  }
  return { result: sign + n.toString(toBase) }
}
