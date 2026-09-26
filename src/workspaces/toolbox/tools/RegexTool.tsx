import { useState } from 'react'
import { regexTest } from './pure/regex'

interface RegexTemplate {
  id: string
  name: string
  pattern: string
  description: string
  example: string
}

const regexTemplates: RegexTemplate[] = [
  { id: 'phone', name: '手机号', pattern: '^1[3-9]\\d{9}$', description: '中国大陆手机号', example: '13812345678' },
  { id: 'email', name: '邮箱', pattern: '^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}$', description: '电子邮箱地址', example: 'test@example.com' },
  { id: 'idcard', name: '身份证号', pattern: '^[1-9]\\d{5}(19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[0-9Xx]$', description: '18位身份证号', example: '110101199003071234' },
  { id: 'url', name: 'URL', pattern: '^https?:\\/\\/[\\w\\-]+(\\.[\\w\\-]+)+[\\w\\-.,@?^=%&:/~+#]*$', description: '网址URL', example: 'https://www.example.com/path' },
  { id: 'ip', name: 'IP地址', pattern: '^(?:(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)\\.){3}(?:25[0-5]|2[0-4]\\d|[01]?\\d\\d?)$', description: 'IPv4地址', example: '192.168.1.1' },
  { id: 'ipv6', name: 'IPv6', pattern: '^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$', description: 'IPv6地址', example: '2001:0db8:85a3:0000:0000:8a2e:0370:7334' },
  { id: 'hex', name: '十六进制', pattern: '^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$', description: '十六进制颜色', example: '#FF5733' },
  { id: 'date', name: '日期', pattern: '^(19|20)\\d{2}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])$', description: '日期格式 YYYY-MM-DD', example: '2024-05-09' },
  { id: 'time', name: '时间', pattern: '^([01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d$', description: '时间格式 HH:MM:SS', example: '14:30:00' },
  { id: 'password', name: '强密码', pattern: '^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]{8,}$', description: '至少8位，含大小写、数字、特殊字符', example: 'Password@123' },
  { id: 'chinese', name: '中文', pattern: '^[\\u4e00-\\u9fa5]+$', description: '纯中文', example: '你好世界' },
  { id: 'zipcode', name: '邮编', pattern: '^\\d{6}$', description: '邮政编码（中国）', example: '100000' },
]

export function RegexTool() {
  const [pattern, setPattern] = useState('')
  const [flags, setFlags] = useState('g')
  const [input, setInput] = useState('')
  const [matches, setMatches] = useState<{ match: string; groups: (string | undefined)[]; index: number }[]>([])
  const [error, setError] = useState('')
  const [selectedTemplate, setSelectedTemplate] = useState<RegexTemplate | null>(null)
  const [showTemplates, setShowTemplates] = useState(false)

  const testRegex = () => {
    const r = regexTest({ pattern, flags, text: input })
    setMatches(r.matches)
    setError(r.error ?? '')
  }

  const applyTemplate = (template: RegexTemplate) => {
    setPattern(template.pattern)
    setInput(template.example)
    setSelectedTemplate(template)
    setShowTemplates(false)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>正则表达式测试</h3>
        <div className="tool-actions">
          <button onClick={() => setShowTemplates(!showTemplates)} className="btn-secondary">模板库</button>
        </div>
      </div>
      <div className="tool-body">
        {showTemplates && (
          <div className="tool-section">
            <h4>常用正则模板</h4>
            <div className="template-grid">
              {regexTemplates.map(t => (
                <button
                  key={t.id}
                  className={`template-item ${selectedTemplate?.id === t.id ? 'active' : ''}`}
                  onClick={() => applyTemplate(t)}
                >
                  <span className="template-name">{t.name}</span>
                  <span className="template-desc">{t.description}</span>
                  <code className="template-pattern">{t.pattern}</code>
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="tool-section">
          <div className="input-group">
            <label>正则表达式</label>
            <div className="regex-input-row">
              <span className="regex-slash">/</span>
              <input
                type="text"
                value={pattern}
                onChange={(e) => { setPattern(e.target.value); setSelectedTemplate(null) }}
                placeholder="输入正则表达式"
              />
              <span className="regex-slash">/</span>
              <input
                type="text"
                value={flags}
                onChange={(e) => setFlags(e.target.value)}
                placeholder="flags"
                style={{ width: 80 }}
              />
              <button onClick={testRegex} disabled={!pattern}>测试</button>
            </div>
          </div>
        </div>

        <div className="tool-section">
          <label>测试文本</label>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入要测试的文本"
            rows={6}
          />
        </div>

        {error && <div className="error-message">{error}</div>}

        {matches.length > 0 && (
          <div className="tool-section">
            <h4>匹配结果 ({matches.length} 个)</h4>
            <div className="matches-list">
              {matches.map((m, i) => (
                <div key={i} className="match-item">
                  <span className="match-index">#{i + 1}</span>
                  <span className="match-text">{m.match}</span>
                  <span className="match-position">@{m.index}</span>
                  {m.groups.length > 0 && (
                    <span className="match-groups">{m.groups.join(', ')}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
