import { useState } from 'react'

export function JsonTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const formatJson = () => {
    try {
      const parsed = JSON.parse(input)
      setOutput(JSON.stringify(parsed, null, 2))
      setError('')
    } catch (e) {
      setError(`JSON 格式错误: ${(e as Error).message}`)
      setOutput('')
    }
  }

  const minifyJson = () => {
    try {
      const parsed = JSON.parse(input)
      setOutput(JSON.stringify(parsed))
      setError('')
    } catch (e) {
      setError(`JSON 格式错误: ${(e as Error).message}`)
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
        <h3>JSON 工具</h3>
        <div className="tool-actions">
          <button onClick={formatJson} disabled={!input}>格式化</button>
          <button onClick={minifyJson} disabled={!input}>压缩</button>
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
            placeholder='{"name": "test", "value": 123}'
            spellCheck={false}
          />
        </div>
        <div className="editor-panel">
          <label>输出</label>
          <textarea
            value={output}
            readOnly
            placeholder="格式化后的 JSON 将显示在这里"
          />
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  )
}
