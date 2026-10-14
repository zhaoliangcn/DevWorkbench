import { useRef, useState } from 'react'

// 工具箱：PDF 工具
// 合并/拆分引擎唯一实现在 pure/pdf.ts（字节进字节出，无 IO）：
// 经 pdf:readBytes 取字节 → 本地引擎处理 → pdf:savePdf / pdf:saveFiles 落盘。
// 文本提取与 PDF→图片由渲染进程 pdfjs-dist 完成；图片→PDF 走主进程
// pdf:imagesToPdf（nativeImage 转码 WebP/GIF/BMP）。
// 文本提取结果可一键存入知识库（SaveToVaultButton 自动捕获 textarea）。

type PickedFile = { path: string; name: string; size: number }
type PdfSource = PickedFile & { pageCount: number | null }
type Tab = 'merge' | 'split' | 'img2pdf' | 'pdf2img' | 'extract'

const TABS: { id: Tab; label: string }[] = [
  { id: 'merge', label: '合并' },
  { id: 'split', label: '拆分' },
  { id: 'img2pdf', label: '图片→PDF' },
  { id: 'pdf2img', label: 'PDF→图片' },
  { id: 'extract', label: '文本提取' },
]

/** pdfjs 懒加载（含 worker），首次使用才拉起代码分块 */
type PdfjsModule = typeof import('pdfjs-dist')
let pdfjsPromise: Promise<PdfjsModule> | null = null
function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = Promise.all([
      import('pdfjs-dist'),
      import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
    ]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default
      return lib
    })
  }
  return pdfjsPromise
}

/** base64 → ArrayBuffer（走 data: URL 原生解码，避免逐字节循环） */
async function base64ToArrayBuffer(b64: string): Promise<ArrayBuffer> {
  const res = await fetch(`data:application/octet-stream;base64,${b64}`)
  return res.arrayBuffer()
}

/** Uint8Array → base64（分块拼接，避免展开运算符栈溢出） */
function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return btoa(binary)
}

function fmtSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

export function PdfTool() {
  const [tab, setTab] = useState<Tab>('merge')
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')

  // 合并
  const [mergeFiles, setMergeFiles] = useState<PickedFile[]>([])
  // 拆分
  const [splitSource, setSplitSource] = useState<PdfSource | null>(null)
  const [splitMode, setSplitMode] = useState<'each' | 'ranges'>('each')
  const [ranges, setRanges] = useState('')
  // 图片→PDF
  const [imgFiles, setImgFiles] = useState<PickedFile[]>([])
  const [imgPageSize, setImgPageSize] = useState<'auto' | 'a4'>('auto')
  // PDF→图片
  const [p2iSource, setP2iSource] = useState<PdfSource | null>(null)
  const [p2iFormat, setP2iFormat] = useState<'png' | 'jpeg'>('png')
  const [p2iScale, setP2iScale] = useState(1.5)
  const [p2iItems, setP2iItems] = useState<{ name: string; base64: string; dataUrl: string }[] | null>(null)
  // 文本提取
  const [exSource, setExSource] = useState<PdfSource | null>(null)
  const [text, setText] = useState('')
  const textRef = useRef<HTMLTextAreaElement>(null)

  const guard = async (fn: () => Promise<string>) => {
    setError('')
    setStatus('')
    setBusy(true)
    try {
      setStatus(await fn())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const pickPdf = async (setter: (s: PdfSource) => void) => {
    setError('')
    setStatus('')
    try {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      const r = await api.pickPdf()
      if (!r.canceled) setter(r)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const addFiles = async (kind: 'pdf' | 'image') => {
    setError('')
    setStatus('')
    try {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      const r = kind === 'pdf' ? await api.pickFiles() : await api.pickImages()
      if (r.canceled || !r.files?.length) return
      const setter = kind === 'pdf' ? setMergeFiles : setImgFiles
      setter((prev) => {
        const seen = new Set(prev.map((f) => f.path))
        return [...prev, ...r.files!.filter((f) => !seen.has(f.path))]
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const moveItem = (list: PickedFile[], setList: (v: PickedFile[]) => void, idx: number, dir: -1 | 1) => {
    const next = [...list]
    const j = idx + dir
    if (j < 0 || j >= next.length) return
    ;[next[idx], next[j]] = [next[j], next[idx]]
    setList(next)
  }

  const runMerge = () =>
    guard(async () => {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (mergeFiles.length < 2) throw new Error('请至少添加两个 PDF 文件')
      const { mergePdfBytes } = await import('./pure/pdf')
      const inputs: Uint8Array[] = []
      for (const f of mergeFiles) {
        const { base64 } = await api.readBytes({ path: f.path })
        inputs.push(new Uint8Array(await base64ToArrayBuffer(base64)))
      }
      const merged = await mergePdfBytes(inputs)
      const suggested = mergeFiles[0].name.replace(/\.pdf$/i, '') + '-merged.pdf'
      const r = await api.savePdf({ base64: bytesToBase64(merged), suggestedName: suggested })
      return r.canceled ? '已取消保存' : `合并完成：${r.saved}`
    })

  const runSplit = () =>
    guard(async () => {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (!splitSource) throw new Error('请先选择 PDF 文件')
      if (splitMode === 'ranges' && !ranges.trim()) throw new Error('请输入页码范围，如 1-3,5,7-9')
      const { base64 } = await api.readBytes({ path: splitSource.path })
      const data = new Uint8Array(await base64ToArrayBuffer(base64))
      const { parsePageRanges, splitPdfBytes, splitFileNames, pdfPageCount } = await import('./pure/pdf')
      const pageCount = await pdfPageCount(data)
      const groups =
        splitMode === 'each'
          ? Array.from({ length: pageCount }, (_, i) => [i])
          : parsePageRanges(ranges, pageCount)
      const outputs = await splitPdfBytes(data, groups)
      const base = splitSource.name.replace(/\.pdf$/i, '')
      const names = splitFileNames(base, groups, pageCount)
      const r = await api.saveFiles({
        items: outputs.map((bytes, i) => ({ name: names[i], base64: bytesToBase64(bytes) })),
      })
      if (r.canceled) return '已取消保存'
      return `拆分完成，共输出 ${r.saved.length} 个文件：\n${r.saved.join('\n')}`
    })

  const runImg2Pdf = () =>
    guard(async () => {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (!imgFiles.length) throw new Error('请先选择图片')
      const r = await api.imagesToPdf({ paths: imgFiles.map((f) => f.path), pageSize: imgPageSize })
      return r.canceled ? '已取消保存' : `转换完成：${r.saved}（共 ${r.pages} 页）`
    })

  const runPdf2Images = () =>
    guard(async () => {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (!p2iSource) throw new Error('请先选择 PDF 文件')
      const { base64 } = await api.readBytes({ path: p2iSource.path })
      const pdfjs = await loadPdfjs()
      const task = pdfjs.getDocument({ data: new Uint8Array(await base64ToArrayBuffer(base64)) })
      const doc = await task.promise
      if (doc.numPages > 100) throw new Error('页数超过 100，请先用拆分功能处理')
      const items: { name: string; base64: string; dataUrl: string }[] = []
      const base = p2iSource.name.replace(/\.pdf$/i, '')
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const viewport = page.getViewport({ scale: p2iScale })
        const canvas = document.createElement('canvas')
        canvas.width = Math.floor(viewport.width)
        canvas.height = Math.floor(viewport.height)
        await page.render({ canvas, viewport }).promise
        const mime = p2iFormat === 'png' ? 'image/png' : 'image/jpeg'
        const dataUrl = canvas.toDataURL(mime, 0.92)
        items.push({ name: `${base}-p${n}.${p2iFormat}`, base64: dataUrl.split(',')[1] ?? '', dataUrl })
        canvas.width = 0
        canvas.height = 0
        page.cleanup()
      }
      const numPages = doc.numPages
      await task.destroy()
      setP2iItems(items)
      return `渲染完成 ${numPages} 页，可预览后保存`
    })

  const savePdf2Images = () =>
    guard(async () => {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (!p2iItems?.length) throw new Error('没有可保存的图片')
      const r = await api.saveFiles({ items: p2iItems.map((it) => ({ name: it.name, base64: it.base64 })) })
      return r.canceled ? '已取消保存' : `已保存 ${r.saved.length} 个文件`
    })

  const runExtract = () =>
    guard(async () => {
      const api = window.electronAPI?.pdf
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (!exSource) throw new Error('请先选择 PDF 文件')
      const { base64 } = await api.readBytes({ path: exSource.path })
      const pdfjs = await loadPdfjs()
      const task = pdfjs.getDocument({ data: new Uint8Array(await base64ToArrayBuffer(base64)) })
      const doc = await task.promise
      const parts: string[] = []
      for (let n = 1; n <= doc.numPages; n++) {
        const page = await doc.getPage(n)
        const content = await page.getTextContent()
        let pageText = ''
        for (const item of content.items) {
          if ('str' in item) {
            pageText += item.str
            if (item.hasEOL) pageText += '\n'
          }
        }
        parts.push(`----- 第 ${n} 页 -----\n${pageText.trim()}`)
        page.cleanup()
      }
      const numPages = doc.numPages
      await task.destroy()
      setText(parts.join('\n\n'))
      return `提取完成：共 ${numPages} 页`
    })

  const copyText = () => {
    const el = textRef.current
    if (!el || !el.value) return
    el.focus()
    el.select()
    const ok = document.execCommand('copy')
    setStatus(ok ? '已复制到剪贴板' : '复制失败，请手动选择复制')
  }

  const saveText = () =>
    guard(async () => {
      const api = window.electronAPI?.file
      if (!api) throw new Error('仅在 Electron 环境可用')
      if (!text) throw new Error('没有可保存的文本')
      const name = (exSource?.name ?? 'extracted').replace(/\.pdf$/i, '') + '.txt'
      const r = await api.saveTextAs(name, text, '文本文件', 'txt')
      if (r.canceled) return '已取消保存'
      if (!r.success) throw new Error(r.error ?? '保存失败')
      return `已保存：${r.path}`
    })

  const renderFileList = (list: PickedFile[], setList: (v: PickedFile[]) => void) => (
    <div style={{ margin: '8px 0' }}>
      {list.map((f, i) => (
        <div key={f.path} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {i + 1}. {f.name}
            <span style={{ opacity: 0.6, marginLeft: 8 }}>{fmtSize(f.size)}</span>
          </span>
          <button onClick={() => moveItem(list, setList, i, -1)} disabled={i === 0} title="上移">
            ↑
          </button>
          <button onClick={() => moveItem(list, setList, i, 1)} disabled={i === list.length - 1} title="下移">
            ↓
          </button>
          <button onClick={() => setList(list.filter((_, j) => j !== i))} title="移除">
            ✕
          </button>
        </div>
      ))}
    </div>
  )

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>PDF 工具</h3>
      </div>
      <div className="tool-body">
        <div className="tool-actions" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTab(t.id)
                setError('')
                setStatus('')
              }}
              style={t.id === tab ? { fontWeight: 700, borderBottom: '2px solid currentColor' } : undefined}
            >
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'merge' && (
          <div className="tool-section">
            <h4>合并多个 PDF（按列表顺序）</h4>
            <div className="tool-actions">
              <button onClick={() => addFiles('pdf')}>添加 PDF 文件</button>
              <button onClick={runMerge} disabled={busy || mergeFiles.length < 2}>
                {busy ? '合并中…' : '合并…'}
              </button>
            </div>
            {renderFileList(mergeFiles, setMergeFiles)}
            <p className="hint">输出顺序即列表顺序，可用 ↑/↓ 调整</p>
          </div>
        )}

        {tab === 'split' && (
          <div className="tool-section">
            <h4>拆分 PDF</h4>
            <div className="tool-actions">
              <button onClick={() => pickPdf(setSplitSource)}>选择 PDF 文件</button>
            </div>
            {splitSource && (
              <div className="file-info">
                <p>
                  名称: {splitSource.name}
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>{fmtSize(splitSource.size)}</span>
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>
                    {splitSource.pageCount != null ? `${splitSource.pageCount} 页` : ''}
                  </span>
                </p>
              </div>
            )}
            {splitSource && (
              <>
                <div className="form-row">
                  <label>拆分方式</label>
                  <select value={splitMode} onChange={(e) => setSplitMode(e.target.value as 'each' | 'ranges')}>
                    <option value="each">每页一个文件</option>
                    <option value="ranges">按页码范围</option>
                  </select>
                </div>
                {splitMode === 'ranges' && (
                  <div className="form-row">
                    <label>页码范围</label>
                    <input
                      value={ranges}
                      onChange={(e) => setRanges(e.target.value)}
                      placeholder="如 1-3,5,7-9（每组一个文件）"
                    />
                  </div>
                )}
                <div className="tool-actions">
                  <button onClick={runSplit} disabled={busy}>
                    {busy ? '拆分中…' : '拆分…'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}

        {tab === 'img2pdf' && (
          <div className="tool-section">
            <h4>图片合成 PDF（每图一页，按列表顺序）</h4>
            <div className="tool-actions">
              <button onClick={() => addFiles('image')}>添加图片</button>
              <button onClick={runImg2Pdf} disabled={busy || !imgFiles.length}>
                {busy ? '转换中…' : '转换为 PDF…'}
              </button>
            </div>
            {renderFileList(imgFiles, setImgFiles)}
            <div className="form-row">
              <label>页面大小</label>
              <select value={imgPageSize} onChange={(e) => setImgPageSize(e.target.value as 'auto' | 'a4')}>
                <option value="auto">适配图片尺寸</option>
                <option value="a4">A4（图片居中等比缩放）</option>
              </select>
            </div>
            <p className="hint">支持 PNG / JPEG / WebP / GIF / BMP（后三种自动转码）</p>
          </div>
        )}

        {tab === 'pdf2img' && (
          <div className="tool-section">
            <h4>PDF 导出为图片</h4>
            <div className="tool-actions">
              <button onClick={() => pickPdf(setP2iSource)}>选择 PDF 文件</button>
            </div>
            {p2iSource && (
              <div className="file-info">
                <p>
                  名称: {p2iSource.name}
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>{fmtSize(p2iSource.size)}</span>
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>
                    {p2iSource.pageCount != null ? `${p2iSource.pageCount} 页` : ''}
                  </span>
                </p>
              </div>
            )}
            {p2iSource && (
              <>
                <div className="form-row">
                  <label>输出格式</label>
                  <select value={p2iFormat} onChange={(e) => setP2iFormat(e.target.value as 'png' | 'jpeg')}>
                    <option value="png">PNG（无损）</option>
                    <option value="jpeg">JPEG（体积小）</option>
                  </select>
                </div>
                <div className="form-row">
                  <label>缩放倍率</label>
                  <select value={p2iScale} onChange={(e) => setP2iScale(Number(e.target.value))}>
                    <option value={1}>1x</option>
                    <option value={1.5}>1.5x</option>
                    <option value={2}>2x</option>
                    <option value={3}>3x</option>
                  </select>
                </div>
                <div className="tool-actions">
                  <button onClick={runPdf2Images} disabled={busy}>
                    {busy ? '渲染中…' : '渲染页面'}
                  </button>
                  {p2iItems && p2iItems.length > 0 && (
                    <button onClick={savePdf2Images} disabled={busy}>
                      保存全部…
                    </button>
                  )}
                </div>
                <p className="hint">最多一次渲染 100 页，大文档请先拆分</p>
              </>
            )}
            {p2iItems && p2iItems.length > 0 && (
              <div className="tool-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
                {p2iItems.map((it) => (
                  <div key={it.name} style={{ textAlign: 'center' }}>
                    <img
                      src={it.dataUrl}
                      alt={it.name}
                      style={{ width: 96, height: 128, objectFit: 'contain', border: '1px solid var(--border, #ccc)' }}
                    />
                    <p style={{ margin: 4, fontSize: 12 }}>{it.name}</p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === 'extract' && (
          <div className="tool-section">
            <h4>提取 PDF 文本</h4>
            <div className="tool-actions">
              <button onClick={() => pickPdf(setExSource)}>选择 PDF 文件</button>
              <button onClick={runExtract} disabled={busy || !exSource}>
                {busy ? '提取中…' : '提取文本'}
              </button>
            </div>
            {exSource && (
              <div className="file-info">
                <p>
                  名称: {exSource.name}
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>{fmtSize(exSource.size)}</span>
                  <span style={{ opacity: 0.6, marginLeft: 8 }}>
                    {exSource.pageCount != null ? `${exSource.pageCount} 页` : ''}
                  </span>
                </p>
              </div>
            )}
            <p className="hint">扫描版 PDF（纯图片）无文本层，提取结果为空；提取文本可点击下方「存入知识库」</p>
            {text && (
              <>
                <textarea
                  ref={textRef}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={14}
                  style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
                />
                <div className="tool-actions">
                  <button onClick={copyText}>复制</button>
                  <button onClick={saveText}>另存为 .txt…</button>
                  <span className="hint">{text.length} 字符</span>
                </div>
              </>
            )}
          </div>
        )}

        {status && <p className="hint" style={{ whiteSpace: 'pre-wrap' }}>{status}</p>}
        {error && <p style={{ color: 'var(--danger, #e5484d)' }}>{error}</p>}
      </div>
    </div>
  )
}
