import { useState } from 'react'

export function Base64Tool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const encode = () => {
    try {
      setOutput(btoa(unescape(encodeURIComponent(input))))
      setError('')
    } catch {
      setError('编码失败')
    }
  }

  const decode = () => {
    try {
      setOutput(decodeURIComponent(escape(atob(input))))
      setError('')
    } catch {
      setError('解码失败: 输入不是有效的 Base64 字符串')
      setOutput('')
    }
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
