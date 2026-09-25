import { useState } from 'react'
import QRCode from 'qrcode'

export function QrCodeTool() {
  const [text, setText] = useState('')
  const [qrImage, setQrImage] = useState('')
  const [error, setError] = useState('')

  const generateQR = async () => {
    if (!text) return
    try {
      const dataUrl = await QRCode.toDataURL(text, { width: 256, margin: 2 })
      setQrImage(dataUrl)
      setError('')
    } catch {
      setError('二维码生成失败')
    }
  }

  const downloadQR = () => {
    if (!qrImage) return
    const link = document.createElement('a')
    link.download = 'qrcode.png'
    link.href = qrImage
    link.click()
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>二维码生成</h3>
        <div className="tool-actions">
          <button onClick={generateQR} disabled={!text}>生成二维码</button>
          <button onClick={downloadQR} disabled={!qrImage} className="btn-secondary">下载</button>
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <label>输入文本或URL</label>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="输入要生成二维码的文本或URL"
            rows={4}
          />
        </div>
        {qrImage && (
          <div className="tool-section qr-preview">
            <h4>预览</h4>
            <img src={qrImage} alt="QR Code" />
          </div>
        )}
        {error && <div className="error-message">{error}</div>}
      </div>
    </div>
  )
}
