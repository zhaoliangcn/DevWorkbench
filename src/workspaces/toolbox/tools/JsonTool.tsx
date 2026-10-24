import { useState } from 'react'
import { electronAPI } from '../utils/electron'
import { jsonTransform } from './pure/json'

export function JsonTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [error, setError] = useState('')

  const formatJson = () => {
    const r = jsonTransform({ text: input, action: 'format' })
    setOutput(r.error ? '' : r.result)
    setError(r.error ?? '')
  }

  const minifyJson = () => {
    const r = jsonTransform({ text: input, action: 'minify' })
    setOutput(r.error ? '' : r.result)
    setError(r.error ?? '')
  }

  const clear = () => {
    setInput('')
    setOutput('')
    setError('')
  }

  // 走主进程 clipboard（渲染层 navigator.clipboard 在部分加载环境会被静默拒绝）
  const copyOutput = async () => {
    const ok = await electronAPI.copyText(output)
    if (!ok) alert('复制失败，请手动复制')
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
