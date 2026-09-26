import { useState } from 'react'
import { base64Transform } from './pure/base64'

export function Base64Tool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const encode = () => {
    const r = base64Transform({ text: input, op: 'encode' })
    setOutput(r.error ? '' : r.result)
    setError(r.error ?? '')
  }

  const decode = () => {
    const r = base64Transform({ text: input, op: 'decode' })
    setOutput(r.error ? '' : r.result)
    setError(r.error ?? '')
  }

  const clear = () => {
    setInput('')
    setOutput('')
    setError('')
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>Base64 转换</h3>
        <div className="tool-actions">
          <button onClick={encode} disabled={!input}>编码</button>
          <button onClick={decode} disabled={!input}>解码</button>
          <button onClick={clear} className="btn-secondary">清空</button>
          <button onClick={copyOutput} disabled={!output} className="btn-secondary">复制结果</button>
        </div>
      </div>
      <div className="tool-body">
        <div className="editor-panel">
          <label>输入</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入要编码或解码的文本"
          />
        </div>
        <div className="editor-panel">
          <label>输出</label>
          <textarea value={output} readOnly placeholder="结果将显示在这里" />
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  )
}
