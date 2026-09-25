import { useState } from 'react'

export function PasswordGeneratorTool() {
  const [length, setLength] = useState(16)
  const [includeUppercase, setIncludeUppercase] = useState(true)
  const [includeLowercase, setIncludeLowercase] = useState(true)
  const [includeNumbers, setIncludeNumbers] = useState(true)
  const [includeSymbols, setIncludeSymbols] = useState(true)
  const [count, setCount] = useState(5)
  const [passwords, setPasswords] = useState<string[]>([])

  const generate = () => {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
    const lowercase = 'abcdefghijklmnopqrstuvwxyz'
    const numbers = '0123456789'
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?'

    let chars = ''
    if (includeUppercase) chars += uppercase
    if (includeLowercase) chars += lowercase
    if (includeNumbers) chars += numbers
    if (includeSymbols) chars += symbols

    if (!chars) return

    const newPasswords: string[] = []
    for (let i = 0; i < count; i++) {
      let password = ''
      const array = new Uint32Array(length)
      crypto.getRandomValues(array)
      for (let j = 0; j < length; j++) {
        password += chars[array[j] % chars.length]
      }
      newPasswords.push(password)
    }
    setPasswords(newPasswords)
  }

  const copyPassword = (pwd: string) => {
    navigator.clipboard.writeText(pwd)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>随机密码生成</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>选项</h4>
          <div className="form-row">
            <label>密码长度: {length}</label>
            <input
              type="range"
              min="6"
              max="64"
              value={length}
              onChange={(e) => setLength(Number(e.target.value))}
            />
          </div>
          <div className="form-row">
            <label>生成数量: {count}</label>
            <input
              type="range"
              min="1"
              max="20"
              value={count}
              onChange={(e) => setCount(Number(e.target.value))}
            />
          </div>
          <div className="tool-section" style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
            <label>
              <input
                type="checkbox"
                checked={includeUppercase}
                onChange={(e) => setIncludeUppercase(e.target.checked)}
                style={{ marginRight: '4px' }}
              />
              大写字母
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeLowercase}
                onChange={(e) => setIncludeLowercase(e.target.checked)}
                style={{ marginRight: '4px' }}
              />
              小写字母
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeNumbers}
                onChange={(e) => setIncludeNumbers(e.target.checked)}
                style={{ marginRight: '4px' }}
              />
              数字
            </label>
            <label>
              <input
                type="checkbox"
                checked={includeSymbols}
                onChange={(e) => setIncludeSymbols(e.target.checked)}
                style={{ marginRight: '4px' }}
              />
              特殊符号
            </label>
          </div>
          <button onClick={generate}>生成密码</button>
        </div>

        {passwords.length > 0 && (
          <div className="tool-section">
            <h4>生成的密码</h4>
            <div className="password-list">
              {passwords.map((pwd, idx) => (
                <div key={idx} className="password-item">
                  <code>{pwd}</code>
                  <button onClick={() => copyPassword(pwd)} className="btn-secondary">复制</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
