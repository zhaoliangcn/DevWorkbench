import { useState, useRef, useEffect, useCallback } from 'react'

export function LogViewerTool() {
  const [file, setFile] = useState<File | null>(null)
  const [lines, setLines] = useState<string[]>([])
  const [filterText, setFilterText] = useState('')
  const [filterLevel, setFilterLevel] = useState('')
  const [displayCount, setDisplayCount] = useState(0)
  const [totalLines, setTotalLines] = useState(0)
  const [autoScroll, setAutoScroll] = useState(true)
  const [loading, setLoading] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const chunkSize = 500

  const logLevels = ['ERROR', 'WARN', 'WARNING', 'INFO', 'DEBUG', 'TRACE']

  const detectLevel = (line: string): string => {
    const upper = line.toUpperCase()
    for (const level of logLevels) {
      if (upper.includes(level)) return level
    }
    return ''
  }

  const loadFile = (f: File) => {
    setFile(f)
    setLoading(true)
    setFilterText('')
    setFilterLevel('')

    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result as string
      const allLines = text.split('\n')
      setLines(allLines)
      setTotalLines(allLines.length)
      setDisplayCount(Math.min(chunkSize, allLines.length))
      setLoading(false)
    }
    reader.readAsText(f)
  }

  const loadMore = useCallback(() => {
    setDisplayCount((prev) => Math.min(prev + chunkSize, totalLines))
  }, [totalLines])

  const filteredLines = lines.slice(0, displayCount).filter((line) => {
    const matchesText = !filterText || line.toLowerCase().includes(filterText.toLowerCase())
    const matchesLevel = !filterLevel || line.toUpperCase().includes(filterLevel)
    return matchesText && matchesLevel
  })

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [filteredLines, autoScroll])

  const getLevelClass = (line: string): string => {
    const level = detectLevel(line)
    switch (level) {
      case 'ERROR': return 'log-error'
      case 'WARN':
      case 'WARNING': return 'log-warn'
      case 'INFO': return 'log-info'
      case 'DEBUG':
      case 'TRACE': return 'log-debug'
      default: return ''
    }
  }

  const scrollToTop = () => {
    containerRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const scrollToBottom = () => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>日志查看器</h3>
        <div className="tool-actions">
          <button onClick={scrollToTop} className="btn-secondary">顶部</button>
          <button onClick={scrollToBottom} className="btn-secondary">底部</button>
          <label className="auto-scroll-label">
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />
            自动滚动
          </label>
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>加载日志文件</h4>
          <div className="form-row">
            <input
              type="file"
              accept=".log,.txt,.json"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) loadFile(f)
              }}
            />
          </div>
          {file && (
            <div className="file-info">
              <p>文件: {file.name}</p>
              <p>大小: {(file.size / 1024 / 1024).toFixed(2)} MB</p>
              <p>总行数: {totalLines.toLocaleString()}</p>
            </div>
          )}
        </div>

        {totalLines > 0 && (
          <div className="tool-section">
            <div className="log-filters">
              <div className="form-row">
                <label>搜索文本</label>
                <input
                  type="text"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                  placeholder="过滤关键词..."
                />
              </div>
              <div className="form-row">
                <label>日志级别</label>
                <select value={filterLevel} onChange={(e) => setFilterLevel(e.target.value)}>
                  <option value="">全部</option>
                  {logLevels.map((level) => (
                    <option key={level} value={level}>{level}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="log-stats">
              <span>显示: {filteredLines.length.toLocaleString()} 行 / {displayCount.toLocaleString()} 行</span>
              {displayCount < totalLines && (
                <button onClick={loadMore} className="btn-secondary">加载更多 ({Math.min(chunkSize, totalLines - displayCount)} 行)</button>
              )}
            </div>
          </div>
        )}

        <div className="tool-section">
          <div className="log-container" ref={containerRef}>
            {loading && <div className="log-loading">加载中...</div>}
            {!loading && filteredLines.length === 0 && totalLines > 0 && (
              <div className="log-empty">无匹配日志</div>
            )}
            {!loading && filteredLines.map((line, idx) => (
              <div key={idx} className={`log-line ${getLevelClass(line)}`}>
                <span className="log-line-num">{idx + 1}</span>
                <span className="log-line-content">{line || ' '}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
