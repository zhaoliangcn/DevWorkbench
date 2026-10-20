// 工具箱：程序员计算器纯逻辑引擎测试（src/workspaces/toolbox/tools/pure/calc.ts）
// 覆盖：四则与位运算优先级（对齐 Windows 计算器）、进制字面量、
// 字长 wrap 与符号语义、移位（算术/逻辑）、错误分支、进制切换字面量转换
import { describe, it, expect } from 'vitest'
import {
  evalExpr,
  convertLiterals,
  type CalcOptions,
} from '../src/workspaces/toolbox/tools/pure/calc'

const D64: CalcOptions = { base: 10, bits: 64, signed: true }
const U64: CalcOptions = { base: 10, bits: 64, signed: false }
const S8: CalcOptions = { base: 10, bits: 8, signed: true }
const U8: CalcOptions = { base: 10, bits: 8, signed: false }
const H64: CalcOptions = { base: 16, bits: 64, signed: false }
const H16: CalcOptions = { base: 16, bits: 16, signed: false }

function evalDec(expr: string, opts: CalcOptions = D64): string {
  const r = evalExpr(expr, opts)
  if (!r.ok) throw new Error(`预期成功，实际报错: ${r.error}`)
  return r.dec
}

function evalErr(expr: string, opts: CalcOptions = D64): string {
  const r = evalExpr(expr, opts)
  if (r.ok) throw new Error(`预期报错，实际成功: ${r.dec}`)
  return r.error
}

describe('四则运算', () => {
  it('加减乘除基础用例', () => {
    expect(evalDec('1+2*3')).toBe('7')
    expect(evalDec('(1+2)*3')).toBe('9')
    expect(evalDec('10/3')).toBe('3')
    expect(evalDec('7-2-3')).toBe('2')
  })

  it('除法向零取整，余数符号随被除数（C 语义）', () => {
    expect(evalDec('-7/2')).toBe('-3')
    expect(evalDec('7/-2')).toBe('-3')
    expect(evalDec('-7%3')).toBe('-1')
    expect(evalDec('7%-3')).toBe('1')
  })

  it('一元负号与嵌套', () => {
    expect(evalDec('-2*3')).toBe('-6')
    expect(evalDec('--5')).toBe('5')
    expect(evalDec('-(3+4)')).toBe('-7')
  })
})

describe('运算符优先级（对齐 Windows 计算器）', () => {
  it('移位低于加减：1<<2+3 = 1<<5', () => {
    expect(evalDec('1<<2+3')).toBe('32')
  })

  it('AND 高于移位、XOR 高于 AND、OR 最低', () => {
    expect(evalDec('1 OR 2 AND 3')).toBe('3') // 1 | (2&3) = 3
    expect(evalDec('2 XOR 3 AND 1')).toBe('3') // 2 ^ (3&1) = 3
    expect(evalDec('2 XOR 3 OR 5 AND 1')).toBe('1') // ((2^3) | (5&1)) = 1
    expect(evalDec('5 AND 3')).toBe('1')
    expect(evalDec('5 | 3')).toBe('7')
    expect(evalDec('5 ^ 3')).toBe('6')
  })

  it('一元 ~ 优先级最高', () => {
    expect(evalDec('~2*3')).toBe('-9') // (~2)*3
    expect(evalDec('~(2*3)')).toBe('-7')
    expect(evalDec('~~5')).toBe('5')
    expect(evalDec('~0')).toBe('-1')
  })
})

describe('进制与字面量', () => {
  it('按当前进制解析数字', () => {
    expect(evalDec('FF+1', H64)).toBe('256')
    expect(evalDec('17', { base: 8, bits: 64, signed: false })).toBe('15')
    expect(evalDec('1010', { base: 2, bits: 64, signed: false })).toBe('10')
  })

  it('显式前缀 0x/0b/0o 在任意进制下可用', () => {
    expect(evalDec('0xFF+1')).toBe('256')
    expect(evalDec('0b1010')).toBe('10')
    expect(evalDec('0o17')).toBe('15')
  })

  it('HEX 字母位大小写不敏感', () => {
    const r = evalExpr('aB', H16)
    expect(r.ok).toBe(true)
    if (r.ok) expect(r.value).toBe(171n)
  })

  it('格式化：HEX 补零大写，BIN 每 4 位分组', () => {
    const r = evalExpr('AB', H16)
    expect(r.ok).toBe(true)
    if (r.ok) {
      expect(r.hex).toBe('00AB')
      expect(r.bin).toBe('0000 0000 1010 1011')
      expect(r.oct).toBe('253')
    }
  })
})

describe('字长与符号语义', () => {
  it('中间结果按字长 wrap（固定宽度寄存器）', () => {
    expect(evalDec('255+1', U8)).toBe('0')
    expect(evalDec('0xFFFFFFFFFFFFFFFF+1', U64)).toBe('0')
    expect(evalDec('0xFFFFFFFFFFFFFFFFF', U64)).toBe('18446744073709551615')
  })

  it('DEC 显示按符号性解释位模式', () => {
    expect(evalDec('128', S8)).toBe('-128')
    expect(evalDec('128', U8)).toBe('128')
    expect(evalDec('~0', U8)).toBe('255')
    expect(evalDec('~0', S8)).toBe('-1')
  })

  it('64 位不丢精度', () => {
    expect(evalDec('0x7FFFFFFFFFFFFFFF+1', U64)).toBe('9223372036854775808')
    expect(evalDec('9007199254740993')).toBe('9007199254740993')
  })
})

describe('移位', () => {
  it('有符号为算术右移，无符号为逻辑右移', () => {
    expect(evalDec('-8>>1', S8)).toBe('-4')
    expect(evalDec('-8>>1', U8)).toBe('124') // 248>>1 逻辑移位
    expect(evalDec('255>>1', U8)).toBe('127')
  })

  it('基础移位', () => {
    expect(evalDec('8>>2')).toBe('2')
    expect(evalDec('1<<10')).toBe('1024')
  })

  it('移位数越界报错', () => {
    expect(evalErr('1<<-2')).toBe('移位数不能为负')
    expect(evalErr('1>>-2')).toBe('移位数不能为负')
    expect(evalErr('1<<100000')).toBe('移位数过大')
  })
})

describe('错误分支', () => {
  it('除零', () => {
    expect(evalErr('1/0')).toBe('除数为零')
    expect(evalErr('5%0')).toBe('除数为零')
  })

  it('语法错误', () => {
    expect(evalErr('')).toBe('表达式为空')
    expect(evalErr('(')).toBe('表达式不完整')
    expect(evalErr('1+')).toBe('表达式不完整')
    expect(evalErr('(1+2')).toBe('括号不匹配')
    expect(evalErr('1+2)')).toBe('表达式存在多余内容')
    expect(evalErr('1 2')).toBe('表达式存在多余内容')
  })

  it('非法字符', () => {
    expect(evalErr('1..2')).toBe('无效字符 "."')
    expect(evalErr('FF', D64)).toBe('无效字符 "F"') // DEC 下字母位非法
    expect(evalErr('"')).toBe('无效字符 """')
  })
})

describe('convertLiterals（进制切换联动）', () => {
  it('数字字面量按进制转换', () => {
    expect(convertLiterals('12+34', 10, 16)).toBe('C+22')
    expect(convertLiterals('C', 16, 10)).toBe('12')
    expect(convertLiterals('0b1010', 10, 16)).toBe('A')
  })

  it('关键字与括号保留', () => {
    expect(convertLiterals('12 AND 0xFF', 10, 16)).toBe('C AND FF')
    expect(convertLiterals('NOT(5)', 10, 2)).toBe('NOT(101)')
  })

  it('无法解析的片段原样保留，不抛错', () => {
    expect(convertLiterals('', 10, 16)).toBe('')
    expect(convertLiterals('abc', 10, 16)).toBe('abc')
    expect(convertLiterals('0F', 10, 16)).toBe('0F') // DEC 下 0F 非法，保持原样
  })
})
