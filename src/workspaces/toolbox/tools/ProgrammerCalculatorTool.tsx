// 程序员计算器：键盘网格 + 进制联动 + 四进制实时结果 + 历史记录 + 字长/符号切换。
// 求值逻辑全部委托 pure/calc.ts（BigInt 引擎），组件只负责交互与展示。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ClipboardEvent as ReactClipboardEvent } from 'react'
import {
  convertLiterals,
  evalExpr,
  type CalcBase,
  type CalcBits,
  type CalcSuccess,
} from './pure/calc'

interface HistoryEntry {
  expr: string
  result: string
}

const HISTORY_KEY = 'devworkbench-programmer-calc-history'
const HISTORY_LIMIT = 20

/** 显示区四进制行（label 可点击切换进制，对齐 Windows 计算器交互） */
const BASE_ROWS: { base: CalcBase; label: string; pick: (r: CalcSuccess) => string }[] = [
  { base: 10, label: 'DEC', pick: (r) => r.dec },
  { base: 16, label: 'HEX', pick: (r) => r.hex },
  { base: 8, label: 'OCT', pick: (r) => r.oct },
  { base: 2, label: 'BIN', pick: (r) => r.bin },
]

interface KeyDef {
  label: string
  kind: 'digit' | 'hex' | 'op' | 'eq'
  /** 点击后追加的表达式片段；CE/BS/EQ/NOT 为特殊行为无 append */
  append?: string
}

const KEY_DEFS: Record<string, KeyDef> = {
  AND: { label: 'AND', kind: 'op', append: ' AND ' },
  OR: { label: 'OR', kind: 'op', append: ' OR ' },
  XOR: { label: 'XOR', kind: 'op', append: ' XOR ' },
  NOT: { label: 'NOT', kind: 'op' },
  '<<': { label: '<<', kind: 'op', append: ' << ' },
  '>>': { label: '>>', kind: 'op', append: ' >> ' },
  '(': { label: '(', kind: 'op', append: '(' },
  ')': { label: ')', kind: 'op', append: ')' },
  '*': { label: '×', kind: 'op', append: ' * ' },
  '/': { label: '÷', kind: 'op', append: ' / ' },
  '%': { label: '%', kind: 'op', append: ' % ' },
  '+': { label: '+', kind: 'op', append: ' + ' },
  '-': { label: '-', kind: 'op', append: ' - ' },
  CE: { label: 'CE', kind: 'op' },
  BS: { label: '⌫', kind: 'op' },
  EQ: { label: '=', kind: 'eq' },
}
'0123456789'.split('').forEach((d) => { KEY_DEFS[d] = { label: d, kind: 'digit', append: d } })
'ABCDEF'.split('').forEach((c) => { KEY_DEFS[c] = { label: c, kind: 'hex', append: c } })

const k = (id: string, span?: number) => ({ id, span })
const KEYPAD_ROWS: { id: string; span?: number }[][] = [
  [k('AND'), k('OR'), k('XOR'), k('NOT'), k('<<'), k('>>')],
  [k('A'), k('B'), k('C'), k('D'), k('E'), k('F')],
  [k('7'), k('8'), k('9'), k('('), k(')'), k('CE')],
  [k('4'), k('5'), k('6'), k('*'), k('/'), k('BS')],
  [k('1'), k('2'), k('3'), k('+'), k('-'), k('%')],
  [k('0', 2), k('EQ', 4)],
]

/** 物理键 → 语义键 id（数字/字母位单独判断） */
const PHYSICAL_MAP: Record<string, string> = {
  '+': '+', '-': '-', '*': '*', '/': '/', '%': '%',
  '(': '(', ')': ')', '&': 'AND', '|': 'OR', '^': 'XOR', '~': 'NOT',
  '<': '<<', '>': '>>',
  Enter: 'EQ', '=': 'EQ', Backspace: 'BS', Escape: 'CE',
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : []
  } catch {
    return []
  }
}

export function ProgrammerCalculatorTool() {
  const [input, setInput] = useState('')
  const [base, setBase] = useState<CalcBase>(10)
  const [bits, setBits] = useState<CalcBits>(64)
  const [signed, setSigned] = useState(true)
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory)
  const [activeKey, setActiveKey] = useState<string | null>(null)

  // 实时求值：输入即算（空输入不求值）
  const live = useMemo(
    () => (input.trim() ? evalExpr(input, { base, bits, signed }) : null),
    [input, base, bits, signed],
  )

  // 历史持久化
  useEffect(() => {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(history))
    } catch {
      // 忽略存储写入失败（隐私模式等）
    }
  }, [history])

  const applyEquals = useCallback(() => {
    const trimmed = input.trim()
    if (!trimmed || !live || !live.ok) return
    const row = BASE_ROWS.find((r) => r.base === base)
    const result = row ? `${row.label} ${row.pick(live)}` : live.dec
    setHistory((prev) =>
      [{ expr: trimmed, result }, ...prev.filter((h) => h.expr !== trimmed)].slice(0, HISTORY_LIMIT),
    )
  }, [input, live, base])

  const switchBase = useCallback((b: CalcBase) => {
    if (b === base) return
    // 表达式中的数字字面量随进制联动转换（关键字/括号/无法解析片段保留）
    setInput((p) => convertLiterals(p, base, b))
    setBase(b)
  }, [base])

  const handleKey = useCallback((id: string) => {
    if (id === 'CE') { setInput(''); return }
    if (id === 'BS') { setInput((p) => p.slice(0, -1)); return }
    if (id === 'EQ') { applyEquals(); return }
    if (id === 'NOT') { setInput((p) => (p.trim() ? `~(${p})` : '~')); return }
    const def = KEY_DEFS[id]
    if (!def?.append) return
    if (def.kind === 'digit' && Number(id) >= base) return
    if (def.kind === 'hex' && base !== 16) return
    setInput((p) => p + def.append)
  }, [applyEquals, base])

  // 物理键盘映射 + 按键高亮
  const flashTimerRef = useRef<number | undefined>(undefined)
  const handlerRef = useRef(handleKey)
  useEffect(() => {
    handlerRef.current = handleKey
  })

  const flash = useCallback((id: string) => {
    setActiveKey(id)
    window.clearTimeout(flashTimerRef.current)
    flashTimerRef.current = window.setTimeout(() => setActiveKey(null), 150)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return
      let id: string
      if (/^[0-9]$/.test(e.key)) id = e.key
      else if (/^[a-f]$/i.test(e.key)) id = e.key.toUpperCase()
      else id = PHYSICAL_MAP[e.key] ?? ''
      if (!id) return
      e.preventDefault()
      handlerRef.current(id)
      flash(id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [flash])

  const isKeyDisabled = (id: string): boolean => {
    const def = KEY_DEFS[id]
    if (!def) return true
    if (def.kind === 'digit') return Number(id) >= base
    if (def.kind === 'hex') return base !== 16
    return false
  }

  const onPaste = (e: ReactClipboardEvent<HTMLDivElement>) => {
    const text = e.clipboardData.getData('text')
    if (!text) return
    e.preventDefault()
    setInput((p) => p + text.trim())
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>程序员计算器</h3>
        <div className="tool-actions">
          <span className="calc-hint">支持物理键盘输入与粘贴，点击进制行可切换</span>
        </div>
      </div>
      <div className="tool-body">
        {/* 显示区：表达式回显 + 四进制实时结果 */}
        <div className="calc-display" tabIndex={0} onPaste={onPaste}>
          <div className="calc-expr">
            {input || <span className="calc-expr-ph">输入表达式（+ - × ÷ % AND OR XOR NOT &lt;&lt; &gt;&gt;）</span>}
          </div>
          {live && live.ok && (
            <div className="calc-rows">
              {BASE_ROWS.map((row) => (
                <div
                  key={row.label}
                  className={`calc-row${base === row.base ? ' active' : ''}`}
                  onClick={() => switchBase(row.base)}
                  title={`切换到 ${row.label}`}
                >
                  <span className="calc-row-label">{row.label}</span>
                  <span className="calc-row-value">{row.pick(live)}</span>
                </div>
              ))}
            </div>
          )}
          {input.trim() && live && !live.ok && <div className="calc-error">{live.error}</div>}
        </div>

        {/* 字长与符号 */}
        <div className="tool-section">
          <h4>字长与符号</h4>
          <div className="mode-selector">
            {([8, 16, 32, 64] as CalcBits[]).map((b) => (
              <button key={b} className={bits === b ? 'active' : ''} onClick={() => setBits(b)}>
                {b} 位
              </button>
            ))}
            <button className={signed ? 'active' : ''} onClick={() => setSigned(true)}>有符号</button>
            <button className={!signed ? 'active' : ''} onClick={() => setSigned(false)}>无符号</button>
          </div>
        </div>

        {/* 键盘网格（数字/字母按当前进制禁用） */}
        <div className="tool-section">
          <div className="calc-keypad">
            {KEYPAD_ROWS.flatMap((row, ri) =>
              row.map(({ id, span }) => {
                const def = KEY_DEFS[id]
                const cls = [
                  'calc-key',
                  def.kind === 'op' ? 'calc-key-op' : '',
                  def.kind === 'eq' ? 'calc-key-eq' : '',
                  span === 2 ? 'calc-key-span2' : '',
                  span === 4 ? 'calc-key-span4' : '',
                  activeKey === id ? 'k-active' : '',
                ].filter(Boolean).join(' ')
                return (
                  <button
                    key={`${ri}-${id}`}
                    className={cls}
                    disabled={isKeyDisabled(id)}
                    onClick={() => handleKey(id)}
                  >
                    {def.label}
                  </button>
                )
              }),
            )}
          </div>
        </div>

        {/* 历史记录（点击回填） */}
        {history.length > 0 && (
          <div className="tool-section">
            <div className="section-header">
              <h4>历史记录（点击回填，最近 {HISTORY_LIMIT} 条）</h4>
              <button className="btn-secondary" onClick={() => setHistory([])}>清空</button>
            </div>
            <div className="calc-history">
              {history.map((h, i) => (
                <div
                  key={`${i}-${h.expr}`}
                  className="calc-history-item"
                  onClick={() => setInput(h.expr)}
                  title="点击回填表达式"
                >
                  <span className="calc-history-expr">{h.expr}</span>
                  <span className="calc-history-val">{h.result}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
