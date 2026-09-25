import { useState } from 'react'

export function FileHashTool() {
  const [file, setFile] = useState<File | null>(null)
  const [hashes, setHashes] = useState<Record<string, string>>({})
  const [calculating, setCalculating] = useState(false)

  const computeHash = async (file: File, algorithm: string): Promise<string> => {
    const buffer = await file.arrayBuffer()
    const hashBuffer = await crypto.subtle.digest(algorithm, buffer)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('')
  }

  const calculateHashes = async () => {
    if (!file) return
    setCalculating(true)
    try {
      const sha1Hash = await computeHash(file, 'SHA-1')
      const sha256Hash = await computeHash(file, 'SHA-256')
      const sha512Hash = await computeHash(file, 'SHA-512')

      setHashes({
        'MD5': '需通过主进程计算',
        'SHA-1': sha1Hash,
        'SHA-256': sha256Hash,
        'SHA-512': sha512Hash,
      })
    } catch (error) {
      setHashes({ error: (error as Error).message })
    } finally {
      setCalculating(false)
    }
  }

  const copyHash = (hash: string) => {
    navigator.clipboard.writeText(hash)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>文件哈希校验</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>选择文件</h4>
          <div className="form-row">
            <input
              type="file"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) {
                  setFile(f)
                  setHashes({})
                }
              }}
            />
          </div>
          {file && (
            <div className="file-info">
              <p>文件名: {file.name}</p>
              <p>大小: {(file.size / 1024).toFixed(2)} KB</p>
              <p>类型: {file.type || '未知'}</p>
            </div>
          )}
          <button onClick={calculateHashes} disabled={!file || calculating}>
            {calculating ? '计算中...' : '计算哈希'}
          </button>
        </div>

        {Object.keys(hashes).length > 0 && (
          <div className="tool-section">
            <h4>哈希值</h4>
            <div className="hash-list">
              {Object.entries(hashes).map(([algo, hash]) => (
                <div key={algo} className="hash-item">
                  <span className="hash-algo">{algo}</span>
                  <code className="hash-value">{hash}</code>
                  <button onClick={() => copyHash(hash)} className="btn-secondary">复制</button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
