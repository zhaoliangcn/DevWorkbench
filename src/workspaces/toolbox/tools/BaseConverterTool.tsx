import { useState } from 'react'
import { radixConvert } from './pure/radix'

/** 全部进制快速参考（复用同一纯函数，无精度丢失） */
function convertAll(value: string, fromBase: number): string {
  return [2, 8, 10, 16]
    .map((b) => `${b}进制: ${radixConvert({ value, fromBase, toBase: b }).result}`)
    .join('\n')
}

export function BaseConverterTool() {
  const [input, setInput] = useState('')
  const [fromBase, setFromBase] = useState(10)
  const [toBase, setToBase] = useState(2)

  const convert = () => {
    const r = radixConvert({ value: input, fromBase, toBase })
    return r.error ?? r.result
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>进制转换</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <div className="form-row">
            <label>输入值</label>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入要转换的数字"
            />
          </div>
          <div className="form-row">
            <label>从进制</label>
            <select value={fromBase} onChange={(e) => setFromBase(Number(e.target.value))}>
              <option value={2}>二进制</option>
              <option value={8}>八进制</option>
              <option value={10}>十进制</option>
              <option value={16}>十六进制</option>
            </select>
          </div>
          <div className="form-row">
            <label>到进制</label>
            <select value={toBase} onChange={(e) => setToBase(Number(e.target.value))}>
              <option value={2}>二进制</option>
              <option value={8}>八进制</option>
              <option value={10}>十进制</option>
              <option value={16}>十六进制</option>
            </select>
          </div>
        </div>

        {input && (
          <div className="tool-section">
            <label>转换结果</label>
            <div className="result-display">
              <textarea
                value={convert()}
                readOnly
                rows={2}
              />
            </div>
          </div>
        )}

        <div className="tool-section">
          <h4>快速参考</h4>
          <div className="result-display">
            <textarea value={input ? convertAll(input, fromBase) : ''} readOnly rows={4} />
          </div>
        </div>
      </div>
    </div>
  )
}
