import { useState } from 'react'

export function TextProcessTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [searchText, setSearchText] = useState('')
  const [replaceText, setReplaceText] = useState('')
  const [useRegex, setUseRegex] = useState(false)

  const removeDuplicates = () => {
    const lines = input.split('\n')
    const unique = [...new Set(lines)]
    setOutput(unique.join('\n'))
  }

  const sortLines = (direction: 'asc' | 'desc') => {
    const lines = input.split('\n')
    lines.sort((a, b) => (direction === 'asc' ? a.localeCompare(b) : b.localeCompare(a)))
    setOutput(lines.join('\n'))
  }

  const replaceAll = () => {
    if (!input || !searchText) return
    if (useRegex) {
      const regex = new RegExp(searchText, 'g')
      setOutput(input.replace(regex, replaceText))
    } else {
      setOutput(input.split(searchText).join(replaceText))
    }
  }

  const changeCase = (type: 'upper' | 'lower' | 'title' | 'camel' | 'snake') => {
    switch (type) {
      case 'upper':
        setOutput(input.toUpperCase())
        break
      case 'lower':
        setOutput(input.toLowerCase())
        break
      case 'title':
        setOutput(input.replace(/\w\S*/g, (txt) =>
          txt.charAt(0).toUpperCase() + txt.slice(1).toLowerCase()
        ))
        break
      case 'camel':
        setOutput(input.toLowerCase().replace(/[^a-zA-Z0-9]+(.)/g, (_, chr) => chr.toUpperCase()))
        break
      case 'snake':
        setOutput(input.match(/[A-Z]{2,}(?=[A-Z][a-z]+[0-9]*|\b)|[A-Z]?[a-z]+[0-9]*|[A-Z]|[0-9]+/g)
          ?.join('_').toLowerCase() || '')
        break
    }
  }

  const trimLines = () => {
    setOutput(input.split('\n').map((line) => line.trim()).join('\n'))
  }

  const removeEmptyLines = () => {
    setOutput(input.split('\n').filter((line) => line.trim()).join('\n'))
  }

  const reverseLines = () => {
    setOutput(input.split('\n').reverse().join('\n'))
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>文本批量处理</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <label>输入文本</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入要处理的文本"
            rows={6}
          />
        </div>

        <div className="tool-section">
          <h4>行操作</h4>
          <div className="tool-actions">
            <button onClick={removeDuplicates} disabled={!input}>行去重</button>
            <button onClick={() => sortLines('asc')} disabled={!input}>升序排序</button>
            <button onClick={() => sortLines('desc')} disabled={!input}>降序排序</button>
            <button onClick={reverseLines} disabled={!input}>反转行序</button>
            <button onClick={trimLines} disabled={!input}>去除首尾空格</button>
            <button onClick={removeEmptyLines} disabled={!input}>删除空行</button>
          </div>
        </div>

        <div className="tool-section">
          <h4>替换操作</h4>
          <div className="form-row">
            <label>查找</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="查找内容"
            />
          </div>
          <div className="form-row">
            <label>替换为</label>
            <input
              type="text"
              value={replaceText}
              onChange={(e) => setReplaceText(e.target.value)}
              placeholder="替换内容"
            />
          </div>
          <div className="tool-actions">
            <label className="inline-check-label">
              <input
                type="checkbox"
                checked={useRegex}
                onChange={(e) => setUseRegex(e.target.checked)}
              />
              使用正则表达式
            </label>
            <button onClick={replaceAll} disabled={!input || !searchText}>全部替换</button>
          </div>
        </div>

        <div className="tool-section">
          <h4>大小写转换</h4>
          <div className="tool-actions">
            <button onClick={() => changeCase('upper')} disabled={!input}>大写</button>
            <button onClick={() => changeCase('lower')} disabled={!input}>小写</button>
            <button onClick={() => changeCase('title')} disabled={!input}>首字母大写</button>
            <button onClick={() => changeCase('camel')} disabled={!input}>驼峰命名</button>
            <button onClick={() => changeCase('snake')} disabled={!input}>下划线命名</button>
          </div>
        </div>

        {output && (
          <div className="tool-section">
            <label>结果</label>
            <div className="result-display">
              <textarea value={output} readOnly rows={6} />
              <button onClick={copyOutput} className="btn-secondary">复制</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
