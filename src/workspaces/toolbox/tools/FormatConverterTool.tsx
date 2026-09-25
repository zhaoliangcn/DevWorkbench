import { useState } from 'react'

type Format = 'json' | 'yaml' | 'toml'

export function FormatConverterTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [fromFormat, setFromFormat] = useState<Format>('json')
  const [toFormat, setToFormat] = useState<Format>('yaml')

  const parseJSON = (str: string) => JSON.parse(str)
  const stringifyJSON = (obj: unknown) => JSON.stringify(obj, null, 2)

  const parseYAML = (str: string) => {
    const result: Record<string, unknown> = {}
    let currentObj: Record<string, unknown> = result
    const lines = str.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))

    for (const line of lines) {
      const match = line.match(/^(\s*)(\w+):\s*(.*)$/)
      if (match) {
        const [, indent, key, value] = match
        const level = indent.length / 2
        if (level === 0) {
          currentObj = result
        }
        if (value) {
          currentObj[key] = value === 'true' ? true : value === 'false' ? false :
            isNaN(Number(value)) ? value : Number(value)
        } else {
          const next: Record<string, unknown> = {}
          currentObj[key] = next
          currentObj = next
        }
      }
    }
    return result
  }

  const stringifyYAML = (obj: Record<string, unknown>, indent = 0) => {
    let result = ''
    const prefix = '  '.repeat(indent)

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        result += `${prefix}${key}:\n${stringifyYAML(value as Record<string, unknown>, indent + 1)}`
      } else {
        result += `${prefix}${key}: ${value}\n`
      }
    }
    return result
  }

  const parseTOML = (str: string) => {
    const result: Record<string, unknown> = {}
    let currentSection: Record<string, unknown> = result
    const lines = str.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'))

    for (const line of lines) {
      const sectionMatch = line.match(/^\[(\w+)\]$/)
      if (sectionMatch) {
        const section: Record<string, unknown> = {}
        currentSection[sectionMatch[1]] = section
        currentSection = section
        continue
      }

      const match = line.match(/^(\w+)\s*=\s*(.+)$/)
      if (match) {
        const [, key, value] = match
        const cleanValue = value.trim().replace(/^"|"$/g, '')
        currentSection[key] = cleanValue === 'true' ? true : cleanValue === 'false' ? false :
          isNaN(Number(cleanValue)) ? cleanValue : Number(cleanValue)
      }
    }
    return result
  }

  const stringifyTOML = (obj: Record<string, unknown>) => {
    let result = ''

    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === 'object' && value !== null) {
        result += `[${key}]\n`
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
          result += `${k} = ${v}\n`
        }
        result += '\n'
      } else {
        result += `${key} = ${value}\n`
      }
    }
    return result
  }

  const convert = () => {
    try {
      let parsed: Record<string, unknown>

      switch (fromFormat) {
        case 'json':
          parsed = parseJSON(input)
          break
        case 'yaml':
          parsed = parseYAML(input)
          break
        case 'toml':
          parsed = parseTOML(input)
          break
      }

      switch (toFormat) {
        case 'json':
          setOutput(stringifyJSON(parsed))
          break
        case 'yaml':
          setOutput(stringifyYAML(parsed))
          break
        case 'toml':
          setOutput(stringifyTOML(parsed))
          break
      }
    } catch (e) {
      setOutput(`转换失败: ${(e as Error).message}`)
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  const formatInput = () => {
    try {
      if (fromFormat === 'json') {
        setOutput(stringifyJSON(parseJSON(input)))
      }
    } catch (e) {
      setOutput(`格式化失败: ${(e as Error).message}`)
    }
  }

  const minifyInput = () => {
    try {
      if (fromFormat === 'json') {
        setOutput(JSON.stringify(parseJSON(input)))
      }
    } catch (e) {
      setOutput(`压缩失败: ${(e as Error).message}`)
    }
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>格式互转 (JSON/YAML/TOML)</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section format-select-row">
          <div className="form-row">
            <label>从格式</label>
            <select value={fromFormat} onChange={(e) => setFromFormat(e.target.value as Format)}>
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
              <option value="toml">TOML</option>
            </select>
          </div>
          <div className="form-row">
            <label>到格式</label>
            <select value={toFormat} onChange={(e) => setToFormat(e.target.value as Format)}>
              <option value="json">JSON</option>
              <option value="yaml">YAML</option>
              <option value="toml">TOML</option>
            </select>
          </div>
        </div>

        <div className="tool-section">
          <label>输入</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`输入 ${fromFormat.toUpperCase()} 内容`}
            rows={8}
          />
          <div className="tool-actions">
            <button onClick={convert} disabled={!input}>转换</button>
            <button onClick={formatInput} disabled={!input} className="btn-secondary">格式化</button>
            <button onClick={minifyInput} disabled={!input} className="btn-secondary">压缩</button>
          </div>
        </div>

        {output && (
          <div className="tool-section">
            <label>结果</label>
            <div className="result-display">
              <textarea value={output} readOnly rows={8} />
              <button onClick={copyOutput} className="btn-secondary">复制</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
