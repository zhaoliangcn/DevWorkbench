import { useState } from 'react'
import CryptoJS from 'crypto-js'

export function CryptoTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [selectedAlgo, setSelectedAlgo] = useState('md5')
  const [key, setKey] = useState('')
  const [mode, setMode] = useState<'hash' | 'aes'>('hash')

  const algorithms = [
    { id: 'md5', name: 'MD5' },
    { id: 'sha1', name: 'SHA-1' },
    { id: 'sha256', name: 'SHA-256' },
    { id: 'sha512', name: 'SHA-512' },
  ]

  const executeHash = () => {
    if (!input) return
    let result = ''
    switch (selectedAlgo) {
      case 'md5':
        result = CryptoJS.MD5(input).toString()
        break
      case 'sha1':
        result = CryptoJS.SHA1(input).toString()
        break
      case 'sha256':
        result = CryptoJS.SHA256(input).toString()
        break
      case 'sha512':
        result = CryptoJS.SHA512(input).toString()
        break
    }
    setOutput(result)
  }

  const aesEncrypt = () => {
    if (!input || !key) return
    const encrypted = CryptoJS.AES.encrypt(input, key).toString()
    setOutput(encrypted)
  }

  const aesDecrypt = () => {
    if (!input || !key) return
    try {
      const decrypted = CryptoJS.AES.decrypt(input, key).toString(CryptoJS.enc.Utf8)
      if (!decrypted) throw new Error('Decryption failed')
      setOutput(decrypted)
    } catch {
      setOutput('解密失败: 密钥错误或输入格式不正确')
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>加密解密</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <div className="mode-selector">
            <button
              className={mode === 'hash' ? 'active' : ''}
              onClick={() => { setMode('hash'); setOutput('') }}
            >
              Hash 加密
            </button>
            <button
              className={mode === 'aes' ? 'active' : ''}
              onClick={() => { setMode('aes'); setOutput('') }}
            >
              AES 加密/解密
            </button>
          </div>
        </div>

        {mode === 'hash' && (
          <div className="tool-section">
            <label>选择算法</label>
            <div className="algo-selector">
              {algorithms.map((algo) => (
                <button
                  key={algo.id}
                  className={selectedAlgo === algo.id ? 'active' : ''}
                  onClick={() => setSelectedAlgo(algo.id)}
                >
                  {algo.name}
                </button>
              ))}
            </div>
            <div className="input-group">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入要加密的文本"
                rows={3}
              />
              <button onClick={executeHash} disabled={!input}>加密</button>
            </div>
          </div>
        )}

        {mode === 'aes' && (
          <div className="tool-section">
            <div className="input-group">
              <label>密钥</label>
              <input
                type="text"
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder="输入加密密钥"
              />
            </div>
            <div className="input-group">
              <label>文本</label>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="输入要加密/解密的文本"
                rows={3}
              />
            </div>
            <div className="tool-actions">
              <button onClick={aesEncrypt} disabled={!input || !key}>AES 加密</button>
              <button onClick={aesDecrypt} disabled={!input || !key}>AES 解密</button>
            </div>
          </div>
        )}

        {output && (
          <div className="tool-section">
            <label>结果</label>
            <div className="result-display">
              <textarea value={output} readOnly rows={3} />
              <button onClick={copyOutput} className="btn-secondary">复制</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
