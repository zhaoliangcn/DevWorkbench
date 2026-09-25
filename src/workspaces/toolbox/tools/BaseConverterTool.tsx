import { useState } from 'react'

export function BaseConverterTool() {
  const [input, setInput] = useState('')
  const [fromBase, setFromBase] = useState(10)
  const [toBase, setToBase] = useState(2)

  const convert = () => {
    try {
      const decimalValue = parseInt(input, fromBase)
      if (isNaN(decimalValue)) {
        return '无效的输入'
      }
      return decimalValue.toString(toBase)
    } catch {
      return '转换失败'
    }
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
            <textarea
              value={`二进制: ${input ? parseInt(input, fromBase).toString(2) : ''}\n八进制: ${input ? parseInt(input, fromBase).toString(8) : ''}\n十进制: ${input ? parseInt(input, fromBase).toString(10) : ''}\n十六进制: ${input ? parseInt(input, fromBase).toString(16) : ''}`}
              readOnly
              rows={4}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
