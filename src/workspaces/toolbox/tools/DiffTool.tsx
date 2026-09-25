import { useState } from 'react'

export function DiffTool() {
  const [text1, setText1] = useState('')
  const [text2, setText2] = useState('')
  const [diffResult, setDiffResult] = useState<{ type: string; text: string }[]>([])

  const computeDiff = () => {
    const lines1 = text1.split('\n')
    const lines2 = text2.split('\n')

    const result: { type: string; text: string }[] = []
    const maxLen = Math.max(lines1.length, lines2.length)

    for (let i = 0; i < maxLen; i++) {
      const line1 = lines1[i] || ''
      const line2 = lines2[i] || ''

      if (line1 === line2) {
        result.push({ type: 'same', text: line1 })
      } else {
        if (line1) result.push({ type: 'removed', text: line1 })
        if (line2) result.push({ type: 'added', text: line2 })
      }
    }

    setDiffResult(result)
  }

  const clearAll = () => {
    setText1('')
    setText2('')
    setDiffResult([])
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>代码对比 Diff</h3>
        <div className="tool-actions">
          <button onClick={computeDiff} disabled={!text1 || !text2}>对比</button>
          <button onClick={clearAll} className="btn-secondary">清空</button>
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <div style={{ display: 'flex', gap: '12px' }}>
            <div className="form-row" style={{ flex: 1 }}>
              <label>原文本</label>
              <textarea
                value={text1}
                onChange={(e) => setText1(e.target.value)}
                placeholder="输入原始文本"
                rows={10}
              />
            </div>
            <div className="form-row" style={{ flex: 1 }}>
              <label>新文本</label>
              <textarea
                value={text2}
                onChange={(e) => setText2(e.target.value)}
                placeholder="输入修改后文本"
                rows={10}
              />
            </div>
          </div>
        </div>

        {diffResult.length > 0 && (
          <div className="tool-section">
            <h4>差异结果</h4>
            <div className="diff-result">
              {diffResult.map((line, idx) => (
                <div
                  key={idx}
                  className={`diff-line ${line.type}`}
                >
                  <span className="diff-marker">
                    {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
                  </span>
                  {line.text || ' '}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
