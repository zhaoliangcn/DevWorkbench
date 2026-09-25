import { useState } from 'react'

export function UrlTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')

  const encode = () => {
    try {
      setOutput(encodeURIComponent(input))
    } catch {
      setOutput('编码失败')
    }
  }

  const decode = () => {
    try {
      setOutput(decodeURIComponent(input))
    } catch {
      setOutput('解码失败: 输入不是有效的编码URL')
    }
  }

  const clear = () => {
    setInput('')
    setOutput('')
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>URL 编解码</h3>
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
            placeholder="https://example.com?q=测试"
          />
        </div>
        <div className="editor-panel">
          <label>输出</label>
          <textarea value={output} readOnly placeholder="结果将显示在这里" />
        </div>
      </div>
    </div>
  )
}
