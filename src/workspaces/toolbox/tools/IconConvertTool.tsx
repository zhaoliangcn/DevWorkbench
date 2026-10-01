import { useState } from 'react'

interface SourceInfo {
  path: string
  name: string
  size: number
  format: string
  width: number
  height: number
  previewDataUrl: string
}

interface ResultItem {
  name: string
  size: number | null
  base64: string
  dataUrl: string
}

const SIZE_OPTIONS = [16, 24, 32, 48, 64, 128, 256]

const FORMAT_LABEL: Record<string, string> = {
  png: 'PNG',
  jpeg: 'JPEG',
  webp: 'WebP',
  gif: 'GIF',
  bmp: 'BMP',
  ico: 'ICO',
  icns: 'ICNS',
}

export function IconConvertTool() {
  const [source, setSource] = useState<SourceInfo | null>(null)
  const [target, setTarget] = useState<'ico' | 'icns' | 'png'>('ico')
  const [sizes, setSizes] = useState<number[]>([16, 32, 48, 128, 256])
  const [results, setResults] = useState<ResultItem[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  const pickFile = async () => {
    setError('')
    setResults(null)
    setStatus('')
    try {
      const api = window.electronAPI?.iconconvert
      if (!api) throw new Error('仅在 Electron 环境可用')
      const result = await api.open()
      if (!result.canceled) setSource(result)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const toggleSize = (size: number) => {
    setSizes((prev) => (prev.includes(size) ? prev.filter((s) => s !== size) : [...prev, size]))
  }

  const generate = async () => {
    if (!source) return
    setError('')
    setStatus('')
    if (target !== 'icns' && sizes.length === 0) {
      setError('请至少选择一个尺寸')
      return
    }
    setBusy(true)
    try {
      const api = window.electronAPI?.iconconvert
      if (!api) throw new Error('仅在 Electron 环境可用')
      const result = await api.generate({
        path: source.path,
        target,
        sizes: target === 'icns' ? undefined : sizes,
      })
      setResults(result.items)
      setStatus('生成完成，可预览后保存')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!results?.length) return
    setError('')
    try {
      const api = window.electronAPI?.iconconvert
      if (!api) throw new Error('仅在 Electron 环境可用')
      const result = await api.save({
        items: results.map((r) => ({ name: r.name, base64: r.base64 })),
        defaultDir: source ? source.path.replace(/[\\/][^\\/]+$/, '') : undefined,
      })
      if (result.canceled) {
        setStatus('已取消保存')
      } else {
        setStatus(`已保存 ${result.saved.length} 个文件：${result.saved.join('、')}`)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>图标转换</h3>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>源文件</h4>
          <div className="tool-actions">
            <button onClick={pickFile}>选择图标 / 图片</button>
          </div>
          <p className="hint">支持 PNG / JPEG / WebP / GIF / BMP / ICO / ICNS，输出 ICO（多尺寸 BMP 帧）、ICNS、PNG</p>
          {source && (
            <div className="file-info">
              <p>名称: {source.name}</p>
              <p>格式: {FORMAT_LABEL[source.format] ?? source.format}</p>
              <p>尺寸: {source.width} x {source.height}</p>
              <p>大小: {(source.size / 1024).toFixed(2)} KB</p>
              {source.previewDataUrl && (
                <img src={source.previewDataUrl} alt="preview" className="image-preview" />
              )}
            </div>
          )}
        </div>

        {source && (
          <div className="tool-section">
            <h4>转换设置</h4>
            <div className="form-row">
              <label>目标格式</label>
              <select value={target} onChange={(e) => setTarget(e.target.value as 'ico' | 'icns' | 'png')}>
                <option value="ico">ICO（Windows，多尺寸 BMP 帧）</option>
                <option value="icns">ICNS（macOS，PNG 块）</option>
                <option value="png">PNG（按尺寸导出）</option>
              </select>
            </div>
            {target !== 'icns' && (
              <div className="form-row">
                <label>尺寸</label>
                <div className="tool-actions">
                  {SIZE_OPTIONS.map((s) => (
                    <label key={s} style={{ marginRight: 8 }}>
                      <input
                        type="checkbox"
                        checked={sizes.includes(s)}
                        onChange={() => toggleSize(s)}
                      />{' '}
                      {s}
                    </label>
                  ))}
                </div>
              </div>
            )}
            {target === 'icns' && (
              <p className="hint">ICNS 按源图尺寸自动包含 16/32/64/128/256/512/1024 中不超过源图的标准档位</p>
            )}
            <div className="tool-actions">
              <button onClick={generate} disabled={busy}>
                {busy ? '生成中…' : '生成'}
              </button>
            </div>
          </div>
        )}

        {results && results.length > 0 && (
          <div className="tool-section">
            <h4>转换结果（{results.length}）</h4>
            <div className="tool-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              {results.map((r) => (
                <div key={r.name} style={{ textAlign: 'center' }}>
                  <img
                    src={r.dataUrl}
                    alt={r.name}
                    style={{ width: 96, height: 96, objectFit: 'contain', background: 'checker' }}
                  />
                  <p style={{ margin: 4, fontSize: 12 }}>{r.name}</p>
                  {r.size !== null && <p style={{ margin: 0, fontSize: 12 }}>{r.size}px</p>}
                </div>
              ))}
            </div>
            <div className="tool-actions">
              <button onClick={save}>保存…</button>
            </div>
          </div>
        )}

        {status && <p className="hint">{status}</p>}
        {error && <p style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
      </div>
    </div>
  )
}
