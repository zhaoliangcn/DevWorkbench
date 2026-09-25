import { useState, useEffect } from 'react'

const timezones = [
  { name: '本地时间', tz: 'local' },
  { name: 'UTC', tz: 'UTC' },
  { name: '北京 (CST)', tz: 'Asia/Shanghai' },
  { name: '东京 (JST)', tz: 'Asia/Tokyo' },
  { name: '伦敦 (GMT)', tz: 'Europe/London' },
  { name: '纽约 (EST)', tz: 'America/New_York' },
  { name: '洛杉矶 (PST)', tz: 'America/Los_Angeles' },
  { name: '悉尼 (AEST)', tz: 'Australia/Sydney' },
]

export function TimestampTool() {
  const [timestamp, setTimestamp] = useState('')
  const [dateStr, setDateStr] = useState('')
  const [result, setResult] = useState('')
  const [now, setNow] = useState(new Date())
  const [selectedTz, setSelectedTz] = useState('Asia/Shanghai')

  const [date1, setDate1] = useState('')
  const [date2, setDate2] = useState('')
  const [dateDiff, setDateDiff] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const formatInTimezone = (date: Date, tz: string) => {
    return date.toLocaleString('zh-CN', {
      timeZone: tz === 'local' ? undefined : tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    })
  }

  const timestampToDate = () => {
    try {
      const ts = parseInt(timestamp)
      const isMillisecond = ts > 1e12
      const date = new Date(isMillisecond ? ts : ts * 1000)
      if (isNaN(date.getTime())) throw new Error('Invalid date')
      setResult(`${date.toISOString()}\n本地: ${date.toLocaleString('zh-CN')}\n${selectedTz}: ${formatInTimezone(date, selectedTz)}`)
    } catch {
      setResult('无效的时间戳')
    }
  }

  const dateToTimestamp = () => {
    try {
      const date = new Date(dateStr)
      if (isNaN(date.getTime())) throw new Error('Invalid date')
      setResult(`秒: ${Math.floor(date.getTime() / 1000)}\n毫秒: ${date.getTime()}`)
    } catch {
      setResult('无效的日期格式')
    }
  }

  const calculateDateDiff = () => {
    if (!date1 || !date2) return
    const d1 = new Date(date1)
    const d2 = new Date(date2)
    const diff = Math.abs(d2.getTime() - d1.getTime())
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60))
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60))
    const seconds = Math.floor((diff % (1000 * 60)) / 1000)
    setDateDiff(`${days} 天 ${hours} 小时 ${minutes} 分 ${seconds} 秒\n总计秒数: ${Math.floor(diff / 1000)}`)
  }

  const copyResult = () => {
    navigator.clipboard.writeText(result)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>时间戳转换</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>当前时间</h4>
          <div className="current-time">
            <span>时间戳: {Math.floor(now.getTime() / 1000)}</span>
            <span>毫秒: {now.getTime()}</span>
            <span>本地: {now.toLocaleString('zh-CN')}</span>
            <span>UTC: {formatInTimezone(now, 'UTC')}</span>
          </div>
        </div>

        <div className="tool-section">
          <h4>时间戳 → 日期</h4>
          <div className="input-group">
            <label>目标时区</label>
            <select value={selectedTz} onChange={(e) => setSelectedTz(e.target.value)}>
              {timezones.map(tz => (
                <option key={tz.tz} value={tz.tz}>{tz.name}</option>
              ))}
            </select>
            <input
              type="text"
              value={timestamp}
              onChange={(e) => setTimestamp(e.target.value)}
              placeholder="输入 Unix 时间戳 (秒或毫秒)"
            />
            <button onClick={timestampToDate} disabled={!timestamp}>转换</button>
          </div>
        </div>

        <div className="tool-section">
          <h4>日期 → 时间戳</h4>
          <div className="input-group">
            <input
              type="datetime-local"
              value={dateStr}
              onChange={(e) => setDateStr(e.target.value)}
            />
            <button onClick={dateToTimestamp} disabled={!dateStr}>转换</button>
          </div>
        </div>

        {result && (
          <div className="tool-section">
            <h4>结果</h4>
            <div className="result-display">
              <textarea value={result} readOnly rows={4} />
              <button onClick={copyResult} className="btn-secondary">复制</button>
            </div>
          </div>
        )}

        <div className="tool-section">
          <h4>日期差计算</h4>
          <div className="form-row">
            <label>日期1</label>
            <input type="datetime-local" value={date1} onChange={(e) => setDate1(e.target.value)} />
          </div>
          <div className="form-row">
            <label>日期2</label>
            <input type="datetime-local" value={date2} onChange={(e) => setDate2(e.target.value)} />
          </div>
          <button onClick={calculateDateDiff} disabled={!date1 || !date2}>计算差值</button>
          {dateDiff && (
            <div className="result-display" style={{ marginTop: '12px' }}>
              <textarea value={dateDiff} readOnly rows={3} />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
