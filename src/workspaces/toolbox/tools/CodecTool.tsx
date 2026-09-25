import { useState } from 'react'

export function CodecTool() {
  const [input, setInput] = useState('')
  const [output, setOutput] = useState('')
  const [selectedCodec, setSelectedCodec] = useState('unicode')

  const codecs = [
    { id: 'unicode', name: 'Unicode' },
    { id: 'hex', name: 'Hex' },
    { id: 'ascii', name: 'ASCII' },
    { id: 'base32', name: 'Base32' },
    { id: 'base64', name: 'Base64' },
    { id: 'morse', name: '摩尔斯密码' },
  ]

  const unicodeEncode = (str: string) => {
    return str.split('').map(char =>
      '\\u' + char.charCodeAt(0).toString(16).padStart(4, '0')
    ).join('')
  }

  const unicodeDecode = (str: string) => {
    return str.replace(/\\u([0-9a-fA-F]{4})/g, (_, code) =>
      String.fromCharCode(parseInt(code, 16))
    )
  }

  const hexEncode = (str: string) => {
    return str.split('').map(char =>
      char.charCodeAt(0).toString(16).padStart(2, '0')
    ).join('')
  }

  const hexDecode = (hex: string) => {
    let result = ''
    for (let i = 0; i < hex.length; i += 2) {
      result += String.fromCharCode(parseInt(hex.substr(i, 2), 16))
    }
    return result
  }

  const asciiEncode = (str: string) => {
    return str.split('').map(c => c.charCodeAt(0)).join(' ')
  }

  const asciiDecode = (str: string) => {
    return str.split(' ').map(code =>
      String.fromCharCode(parseInt(code))
    ).join('')
  }

  const base32Encode = (str: string) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = ''
    let result = ''
    for (let i = 0; i < str.length; i++) {
      bits += str.charCodeAt(i).toString(2).padStart(8, '0')
    }
    while (bits.length % 5 !== 0) bits += '0'
    for (let i = 0; i < bits.length; i += 5) {
      result += chars[parseInt(bits.substr(i, 5), 2)]
    }
    return result
  }

  const base32Decode = (str: string) => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
    let bits = ''
    let result = ''
    for (let i = 0; i < str.length; i++) {
      const idx = chars.indexOf(str[i].toUpperCase())
      if (idx >= 0) bits += idx.toString(2).padStart(5, '0')
    }
    while (bits.length % 8 !== 0) bits = bits.slice(0, -1)
    for (let i = 0; i < bits.length; i += 8) {
      result += String.fromCharCode(parseInt(bits.substr(i, 8), 2))
    }
    return result
  }

  const morseEncode = (str: string) => {
    const morseMap: Record<string, string> = {
      'A': '.-', 'B': '-...', 'C': '-.-.', 'D': '-..', 'E': '.',
      'F': '..-.', 'G': '--.', 'H': '....', 'I': '..', 'J': '.---',
      'K': '-.-', 'L': '.-..', 'M': '--', 'N': '-.', 'O': '---',
      'P': '.--.', 'Q': '--.-', 'R': '.-.', 'S': '...', 'T': '-',
      'U': '..-', 'V': '...-', 'W': '.--', 'X': '-..-', 'Y': '-.--',
      'Z': '--..', '0': '-----', '1': '.----', '2': '..---',
      '3': '...--', '4': '....-', '5': '.....', '6': '-....',
      '7': '--...', '8': '---..', '9': '----.', ' ': '/'
    }
    return str.toUpperCase().split('').map(c => morseMap[c] || '').join(' ')
  }

  const morseDecode = (str: string) => {
    const morseMap: Record<string, string> = {
      '.-': 'A', '-...': 'B', '-.-.': 'C', '-..': 'D', '.': 'E',
      '..-.': 'F', '--.': 'G', '....': 'H', '..': 'I', '.---': 'J',
      '-.-': 'K', '.-..': 'L', '--': 'M', '-.': 'N', '---': 'O',
      '.--.': 'P', '--.-': 'Q', '.-.': 'R', '...': 'S', '-': 'T',
      '..-': 'U', '...-': 'V', '.--': 'W', '-..-': 'X', '-.--': 'Y',
      '--..': 'Z', '-----': '0', '.----': '1', '..---': '2',
      '...--': '3', '....-': '4', '.....': '5', '-....': '6',
      '--...': '7', '---..': '8', '----.': '9', '/': ' '
    }
    return str.split(' ').map(c => morseMap[c] || '').join('')
  }

  const encode = () => {
    if (!input) return
    switch (selectedCodec) {
      case 'unicode': setOutput(unicodeEncode(input)); break
      case 'hex': setOutput(hexEncode(input)); break
      case 'ascii': setOutput(asciiEncode(input)); break
      case 'base32': setOutput(base32Encode(input)); break
      case 'base64': setOutput(btoa(unescape(encodeURIComponent(input)))); break
      case 'morse': setOutput(morseEncode(input)); break
    }
  }

  const decode = () => {
    if (!input) return
    switch (selectedCodec) {
      case 'unicode': setOutput(unicodeDecode(input)); break
      case 'hex': setOutput(hexDecode(input)); break
      case 'ascii': setOutput(asciiDecode(input)); break
      case 'base32': setOutput(base32Decode(input)); break
      case 'base64': setOutput(decodeURIComponent(escape(atob(input)))); break
      case 'morse': setOutput(morseDecode(input)); break
    }
  }

  const copyOutput = () => {
    navigator.clipboard.writeText(output)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>高级编解码</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <label>选择编解码方式</label>
          <div className="algo-selector">
            {codecs.map(c => (
              <button
                key={c.id}
                className={selectedCodec === c.id ? 'active' : ''}
                onClick={() => { setSelectedCodec(c.id); setOutput('') }}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="tool-section">
          <div className="input-group">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入要编解码的文本"
              rows={4}
            />
          </div>
          <div className="tool-actions">
            <button onClick={encode} disabled={!input}>编码</button>
            <button onClick={decode} disabled={!input}>解码</button>
          </div>
        </div>

        {output && (
          <div className="tool-section">
            <label>结果</label>
            <div className="result-display">
              <textarea value={output} readOnly rows={4} />
              <button onClick={copyOutput} className="btn-secondary">复制</button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
