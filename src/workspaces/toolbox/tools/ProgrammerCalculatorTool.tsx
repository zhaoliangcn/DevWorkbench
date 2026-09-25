import { useState } from 'react'

export function ProgrammerCalculatorTool() {
  const [input, setInput] = useState('')
  const [result, setResult] = useState('')
  const [mode, setMode] = useState<'normal' | 'bitwise'>('normal')

  const evaluate = () => {
    try {
      if (mode === 'normal') {
        const sanitized = input.replace(/[^0-9+\-*/().%\s]/g, '')
        const r = Function(`"use strict"; return (${sanitized})`)()
        setResult(String(r))
      } else {
        const sanitized = input
          .replace(/AND/g, '&')
          .replace(/OR/g, '|')
          .replace(/XOR/g, '^')
          .replace(/NOT/g, '~')
          .replace(/<< /g, '<<')
          .replace(/>> /g, '>>')
        const r = Function(`"use strict"; return (${sanitized})`)()
        const num = Number(r)
        setResult(`十进制: ${num}\n二进制: ${num.toString(2)}\n八进制: ${num.toString(8)}\n十六进制: ${num.toString(16).toUpperCase()}`)
      }
    } catch {
      setResult('表达式无效')
    }
  }

  const clear = () => {
    setInput('')
    setResult('')
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>程序员计算器</h3>
        <div className="tool-actions">
          <button
            className={`mode-btn ${mode === 'normal' ? 'active' : ''}`}
            onClick={() => { setMode('normal'); clear() }}
          >
            普通
          </button>
          <button
            className={`mode-btn ${mode === 'bitwise' ? 'active' : ''}`}
            onClick={() => { setMode('bitwise'); clear() }}
          >
            位运算
          </button>
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入表达式"
            className="calc-input calc-input-full"
          />
          <div className="tool-actions">
            <button onClick={evaluate} disabled={!input}>计算</button>
            <button onClick={clear} className="btn-secondary">清空</button>
          </div>
        </div>

        {mode === 'bitwise' && (
          <div className="tool-section">
            <h4>位运算符</h4>
            <div className="operator-list">
              <button onClick={() => setInput((prev) => prev + ' & ')}>AND</button>
              <button onClick={() => setInput((prev) => prev + ' | ')}>OR</button>
              <button onClick={() => setInput((prev) => prev + ' ^ ')}>XOR</button>
              <button onClick={() => setInput((prev) => '~(' + prev + ')')}>NOT</button>
              <button onClick={() => setInput((prev) => prev + ' << ')}>&lt;&lt;</button>
              <button onClick={() => setInput((prev) => prev + ' >> ')}>&gt;&gt;</button>
            </div>
          </div>
        )}

        {result && (
          <div className="tool-section">
            <h4>结果</h4>
            <div className="result-display">
              <textarea value={result} readOnly rows={4} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
