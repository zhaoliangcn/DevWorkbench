import { useState, useRef } from 'react'

export function ImageTool() {
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imageSrc, setImageSrc] = useState('')
  const [imageBase64, setImageBase64] = useState('')
  const [imageInfo, setImageInfo] = useState<Record<string, string | number>>({})
  const [outputFormat, setOutputFormat] = useState('png')
  const [compressedSrc, setCompressedSrc] = useState('')
  const [quality, setQuality] = useState(0.8)
  const [targetWidth, setTargetWidth] = useState(0)
  const [targetHeight, setTargetHeight] = useState(0)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const loadImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setImageFile(file)
    const reader = new FileReader()
    reader.onload = (event) => {
      const result = event.target?.result as string
      setImageSrc(result)
      setImageBase64(result)

      const img = new Image()
      img.onload = () => {
        setImageInfo({
          width: img.width,
          height: img.height,
          size: file.size,
          type: file.type,
          name: file.name,
        })
        setTargetWidth(img.width)
        setTargetHeight(img.height)
      }
      img.src = result
    }
    reader.readAsDataURL(file)
  }

  const convertToBase64 = () => {
    if (!imageFile) return
    const reader = new FileReader()
    reader.onload = (e) => {
      setImageBase64(e.target?.result as string)
    }
    reader.readAsDataURL(imageFile)
  }

  const decodeBase64 = () => {
    if (!imageBase64) return
    setImageSrc(imageBase64)
  }

  const compressImage = () => {
    if (!imageSrc) return

    const img = new Image()
    img.onload = () => {
      const canvas = canvasRef.current
      if (!canvas) return

      const ctx = canvas.getContext('2d')
      if (!ctx) return

      canvas.width = targetWidth || img.width
      canvas.height = targetHeight || img.height

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

      const mimeType = `image/${outputFormat}`
      const dataUrl = canvas.toDataURL(mimeType, quality)
      setCompressedSrc(dataUrl)
    }
    img.src = imageSrc
  }

  const downloadImage = () => {
    if (!compressedSrc) return
    const a = document.createElement('a')
    a.href = compressedSrc
    a.download = `converted.${outputFormat}`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const copyBase64 = () => {
    navigator.clipboard.writeText(imageBase64)
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>图片工具</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>加载图片</h4>
          <input type="file" accept="image/*" onChange={loadImage} />
          {imageInfo.width && (
            <div className="file-info">
              <p>名称: {imageInfo.name}</p>
              <p>尺寸: {imageInfo.width} x {imageInfo.height}</p>
              <p>大小: {(Number(imageInfo.size) / 1024).toFixed(2)} KB</p>
              <p>类型: {imageInfo.type}</p>
            </div>
          )}
        </div>

        {imageSrc && (
          <div className="tool-section">
            <h4>原图预览</h4>
            <img src={imageSrc} alt="preview" className="image-preview" />
          </div>
        )}

        <div className="tool-section">
          <h4>Base64 互转</h4>
          <div className="tool-actions">
            <button onClick={convertToBase64} disabled={!imageFile}>图片转 Base64</button>
            <button onClick={decodeBase64} disabled={!imageBase64}>Base64 转图片</button>
            <button onClick={copyBase64} disabled={!imageBase64} className="btn-secondary">复制 Base64</button>
          </div>
          {imageBase64 && (
            <textarea
              value={imageBase64.substring(0, 1000)}
              readOnly
              rows={4}
              className="base64-output"
            />
          )}
        </div>

        {imageSrc && (
          <div className="tool-section">
            <h4>压缩/格式转换</h4>
            <div className="form-row">
              <label>输出格式</label>
              <select value={outputFormat} onChange={(e) => setOutputFormat(e.target.value)}>
                <option value="png">PNG</option>
                <option value="jpeg">JPEG</option>
                <option value="webp">WebP</option>
              </select>
            </div>
            <div className="form-row">
              <label>质量: {(quality * 100).toFixed(0)}%</label>
              <input
                type="range"
                min="0.1"
                max="1"
                step="0.1"
                value={quality}
                onChange={(e) => setQuality(Number(e.target.value))}
              />
            </div>
            <div className="form-row">
              <label>宽度</label>
              <input
                type="number"
                value={targetWidth}
                onChange={(e) => setTargetWidth(Number(e.target.value))}
              />
            </div>
            <div className="form-row">
              <label>高度</label>
              <input
                type="number"
                value={targetHeight}
                onChange={(e) => setTargetHeight(Number(e.target.value))}
              />
            </div>
            <button onClick={compressImage}>压缩/转换</button>
          </div>
        )}

        {compressedSrc && (
          <div className="tool-section">
            <h4>转换结果</h4>
            <img src={compressedSrc} alt="compressed" className="image-preview" />
            <div className="tool-actions">
              <button onClick={downloadImage}>下载</button>
            </div>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden-canvas" />
      </div>
    </div>
  )
}
