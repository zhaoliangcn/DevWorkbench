import { dialog, ipcMain, nativeImage, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

// 工具箱：图标格式转换（iconconvert:*）
// 解码/缩放复用 Electron 内置 nativeImage，ICO/ICNS 容器为纯 JS 打包，零新增依赖。
// ICO 256px 帧固定使用 BMP 编码：electron-builder(resedit 1.7.2) 无法解析 PNG 帧。

type SourceFormat = 'png' | 'jpeg' | 'webp' | 'gif' | 'bmp' | 'ico' | 'icns'

interface IcoEntry {
  width: number
  height: number
  bitCount: number
  offset: number
  bytes: number
  png: boolean
}

interface Frame {
  size: number
  bgra: Buffer // 直通 alpha（非预乘），BGRA 序
}

interface GenerateItem {
  name: string
  size: number | null
  base64: string
  dataUrl: string
}

const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256]
const ICNS_TYPE_BY_SIZE: Record<number, string> = {
  16: 'icp4',
  32: 'icp5',
  64: 'ic12',
  128: 'ic07',
  256: 'ic08',
  512: 'ic09',
  1024: 'ic10',
}
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** 长度安全的 PNG 签名判定（前 4 字节） */
function isPng(buf: Buffer, offset = 0): boolean {
  return (
    buf.length >= offset + 4 &&
    buf[offset] === 0x89 &&
    buf[offset + 1] === 0x50 &&
    buf[offset + 2] === 0x4e &&
    buf[offset + 3] === 0x47
  )
}

function detectFormat(buf: Buffer): SourceFormat | null {
  if (buf.length < 12) return null
  if (buf.subarray(0, 8).equals(PNG_MAGIC)) return 'png'  // 8 字节完整签名
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'gif'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'
  if (buf[0] === 0 && buf[1] === 0 && buf[2] === 1 && buf[3] === 0) return 'ico'
  if (buf.subarray(0, 4).toString('ascii') === 'icns') return 'icns'
  return null
}

/** PNG IHDR 宽高（大端，偏移 16/20） */
function pngDimensions(buf: Buffer): { width: number; height: number } {
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

function parseIcoEntries(buf: Buffer): IcoEntry[] {
  const count = buf.readUInt16LE(4)
  const entries: IcoEntry[] = []
  for (let i = 0; i < count; i++) {
    const o = 6 + i * 16
    const offset = buf.readUInt32LE(o + 12)
    entries.push({
      width: buf[o] || 256,
      height: buf[o + 1] || 256,
      bitCount: buf.readUInt16LE(o + 6),
      bytes: buf.readUInt32LE(o + 8),
      offset,
      png: isPng(buf, offset),
    })
  }
  return entries
}

/** ICO 单帧 BMP → 直通 alpha BGRA（自下而上存储行序翻正） */
function icoBmpFrameToBgra(buf: Buffer, e: IcoEntry): Frame {
  const w = e.width
  const h = e.height
  const bpp = e.bitCount
  const header = buf.readUInt32LE(e.offset) // BITMAPINFOHEADER size (40)
  const biHeight = Math.abs(buf.readInt32LE(e.offset + 8))
  const height = biHeight === h * 2 ? h : biHeight // 双高含 AND mask；异常值兜底
  const maskRow = Math.ceil(w / 32) * 4

  const out = Buffer.alloc(w * height * 4)
  if (bpp === 32) {
    for (let y = 0; y < height; y++) {
      const src = e.offset + (header || 40) + (height - 1 - y) * w * 4
      buf.copy(out, y * w * 4, src, src + w * 4)
    }
  } else if (bpp === 24) {
    const rowBytes = Math.ceil(w * 3 / 4) * 4
    out.fill(0xff, 3, 4) // A=255 模板：每像素第 4 字节
    for (let y = 0; y < height; y++) {
      const src = e.offset + (header || 40) + (height - 1 - y) * rowBytes
      const maskRowStart = e.offset + (header || 40) + rowBytes * height + (height - 1 - y) * maskRow
      for (let x = 0; x < w; x++) {
        const di = (y * w + x) * 4
        const si = src + x * 3
        out[di] = buf[si + 2]
        out[di + 1] = buf[si + 1]
        out[di + 2] = buf[si]
        // AND mask：置位 = 透明（24bpp 无 alpha 通道）
        if (buf[maskRowStart + (x >> 3)] & (0x80 >> (x & 7))) out[di + 3] = 0
      }
    }
  } else {
    throw new Error(`暂不支持 ${bpp}bpp 的 ICO 帧（${w}x${h}）`)
  }
  return { size: Math.max(w, height), bgra: out }
}

/** 用 nativeImage 解码任意来源帧（PNG/ICO帧/ICNS块），缩放并居中到 size×size 透明底 */
function fitSquareBgra(pngBuf: Buffer, size: number): Frame {
  let img = nativeImage.createFromBuffer(pngBuf)
  if (img.isEmpty()) throw new Error('源图像无法解码')
  const src = img.getSize()
  const scale = Math.min(size / src.width, size / src.height)
  let w = Math.max(1, Math.round(src.width * scale))
  let h = Math.max(1, Math.round(src.height * scale))
  if (w > size) w = size
  if (h > size) h = size
  if (w !== src.width || h !== src.height) {
    img = img.resize({ width: w, height: h, quality: 'best' })
    const rs = img.getSize()
    w = rs.width
    h = rs.height
  }
  const raw = img.toBitmap() // BGRA
  const rawStride = w * 4
  const out = Buffer.alloc(size * size * 4) // 全透明
  const offX = Math.floor((size - w) / 2)
  const offY = Math.floor((size - h) / 2)
  for (let y = 0; y < h; y++) {
    raw.copy(out, ((y + offY) * size + offX) * 4, y * rawStride, (y + 1) * rawStride)
  }
  // nativeImage 返回预乘 alpha；ICO/BMP 期望直通 alpha，做反预乘
  for (let i = 0; i < out.length; i += 4) {
    const a = out[i + 3]
    if (a > 0 && a < 255) {
      out[i] = Math.min(255, Math.round((out[i] * 255) / a))
      out[i + 1] = Math.min(255, Math.round((out[i + 1] * 255) / a))
      out[i + 2] = Math.min(255, Math.round((out[i + 2] * 255) / a))
    }
  }
  return { size, bgra: out }
}

/** 任意源（栅格图/ICO/ICNS）→ 指定尺寸帧集合 */
function decodeToFrames(srcBuf: Buffer, format: SourceFormat, sizes: number[]): { frames: Frame[]; largestPng: Buffer } {
  // 统一先拿到"最大可用 PNG"，再由 nativeImage 缩放
  let largestPng: Buffer
  if (format === 'ico') {
    const entries = parseIcoEntries(srcBuf)
    const best = entries.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a))
    largestPng = best.png ? srcBuf.subarray(best.offset, best.offset + best.bytes) : frameToPng(srcBuf, best)
  } else if (format === 'icns') {
    const chunks = parseIcnsChunks(srcBuf)
    const best = chunks.reduce((a, b) => (b.png.length > a.png.length ? b : a))
    largestPng = best.png
  } else {
    largestPng = srcBuf
  }
  const frames = sizes.map((size) => fitSquareBgra(largestPng, size))
  return { frames, largestPng }
}

/** 帧 BGRA → ICO 位图帧（BITMAPINFOHEADER + 自下而上 XOR + AND mask 全 0） */
function encodeIcoFrameBmp(frame: Frame): Buffer {
  const { size, bgra } = frame
  const maskRow = Math.ceil(size / 32) * 4
  const bmp = Buffer.alloc(40 + size * size * 4 + maskRow * size)
  bmp.writeUInt32LE(40, 0)
  bmp.writeInt32LE(size, 4)
  bmp.writeInt32LE(size * 2, 8) // 双高：XOR + AND
  bmp.writeUInt16LE(1, 12)
  bmp.writeUInt16LE(32, 14)
  bmp.writeUInt32LE(size * size * 4, 20)
  const xor = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    bgra.copy(xor, (size - 1 - y) * size * 4, y * size * 4, (y + 1) * size * 4)
  }
  xor.copy(bmp, 40)
  return bmp
}

function encodeIco(frames: Frame[]): Buffer {
  const sorted = [...frames].sort((a, b) => a.size - b.size)
  const bmps = sorted.map(encodeIcoFrameBmp)
  const dirSize = 6 + sorted.length * 16
  const total = dirSize + bmps.reduce((s, b) => s + b.length, 0)
  const out = Buffer.alloc(total)
  out[2] = 1 // type: icon
  out.writeUInt16LE(sorted.length, 4)
  let offset = dirSize
  sorted.forEach((f, i) => {
    const o = 6 + i * 16
    out[o] = f.size % 256
    out[o + 1] = f.size % 256
    out.writeUInt16LE(1, o + 4) // planes
    out.writeUInt16LE(32, o + 6) // bitCount
    out.writeUInt32LE(bmps[i].length, o + 8)
    out.writeUInt32LE(offset, o + 12)
    bmps[i].copy(out, offset)
    offset += bmps[i].length
  })
  return out
}

interface IcnsChunk {
  type: string
  png: Buffer
}

function parseIcnsChunks(buf: Buffer): IcnsChunk[] {
  const chunks: IcnsChunk[] = []
  let off = 8
  while (off + 8 <= buf.length) {
    const type = buf.subarray(off, off + 4).toString('ascii')
    const len = buf.readUInt32LE(off + 4)
    if (len < 8 || off + len > buf.length) break
    const data = buf.subarray(off + 8, off + len)
    if (PNG_TYPES.has(type) && isPng(data)) {
      chunks.push({ type, png: Buffer.from(data) })
    }
    off += len
  }
  if (!chunks.length) throw new Error('ICNS 中未找到 PNG 类型块')
  return chunks
}

const PNG_TYPES = new Set(['icp4', 'icp5', 'icp6', 'ic07', 'ic08', 'ic09', 'ic10', 'ic11', 'ic12', 'ic13', 'ic14'])

function encodeIcns(chunks: { type: string; png: Buffer }[]): Buffer {
  const total = 8 + chunks.reduce((s, c) => s + 8 + c.png.length, 0)
  const out = Buffer.alloc(total)
  out.write('icns', 0, 'ascii')
  out.writeUInt32LE(total, 4)
  let off = 8
  for (const c of chunks) {
    out.write(c.type, off, 'ascii')
    out.writeUInt32LE(8 + c.png.length, off + 4)
    c.png.copy(out, off + 8)
    off += 8 + c.png.length
  }
  return out
}

/** ICO/ICNS 帧或块 → PNG Buffer */
function frameToPng(srcBuf: Buffer, e: IcoEntry): Buffer {
  if (e.png) return Buffer.from(srcBuf.subarray(e.offset, e.offset + e.bytes))
  const { size, bgra } = icoBmpFrameToBgra(srcBuf, e)
  return nativeImage.createFromBitmap(bgra, { width: size, height: size }).toPNG()
}

/** 以下引擎函数导出仅供测试脚本使用（scripts/icon-convert-test.mjs） */
export { detectFormat, parseIcoEntries, parseIcnsChunks, decodeToFrames, frameToPng, encodeIco, encodeIcns }

export function registerIconConvertIpc() {
  ipcMain.handle('iconconvert:open', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [
        { name: '图标/图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'ico', 'icns'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return { canceled: true }
    const filePath = result.filePaths[0]
    const buf = fs.readFileSync(filePath)
    const format = detectFormat(buf)
    if (!format) throw new Error('无法识别的文件格式')
    let width = 0
    let height = 0
    let previewDataUrl = ''
    if (format === 'ico') {
      const entries = parseIcoEntries(buf)
      width = Math.max(...entries.map((e) => e.width))
      height = Math.max(...entries.map((e) => e.height))
      const best = entries.reduce((a, b) => (b.width <= 256 && b.width > a.width ? b : a), entries[0])
      previewDataUrl = 'data:image/png;base64,' + frameToPng(buf, best).toString('base64')
    } else if (format === 'icns') {
      const chunks = parseIcnsChunks(buf)
      const dims = chunks.map((c) => pngDimensions(c.png))
      width = Math.max(...dims.map((d) => d.width))
      height = Math.max(...dims.map((d) => d.height))
      const best = chunks.reduce((a, b) => (b.png.length > a.png.length ? b : a))
      previewDataUrl = 'data:image/png;base64,' + best.png.toString('base64')
    } else {
      const img = nativeImage.createFromBuffer(buf)
      if (img.isEmpty()) throw new Error('图像无法解码')
      const s = img.getSize()
      width = s.width
      height = s.height
      const scale = Math.min(1, 256 / Math.max(width, height))
      const preview = scale < 1 ? img.resize({ width: Math.round(width * scale), quality: 'best' }) : img
      previewDataUrl = preview.toDataURL()
    }
    return {
      canceled: false,
      path: filePath,
      name: path.basename(filePath),
      size: buf.length,
      format,
      width,
      height,
      previewDataUrl,
    }
  })

  ipcMain.handle('iconconvert:generate', async (_event, args: { path: string; target: 'ico' | 'icns' | 'png'; sizes?: number[] }) => {
    const { path: filePath, target } = args
    const buf = fs.readFileSync(filePath)
    const format = detectFormat(buf)
    if (!format) throw new Error('无法识别的文件格式')
    const base = path.basename(filePath).replace(/\.(png|jpe?g|webp|gif|bmp|ico|icns)$/i, '')
    const items: GenerateItem[] = []

    if (target === 'ico') {
      const sizes = (args.sizes ?? ICO_SIZES).filter((s) => s > 0 && s <= 256)
      if (!sizes.length) throw new Error('请至少选择一个尺寸')
      const { frames } = decodeToFrames(buf, format, sizes)
      const ico = encodeIco(frames)
      items.push({ name: `${base}.ico`, size: null, base64: ico.toString('base64'), dataUrl: '' })
      // 预览：最大帧转 PNG
      const largest = frames[frames.length - 1]
      const png = nativeImage.createFromBitmap(largest.bgra, { width: largest.size, height: largest.size }).toPNG()
      items[0].dataUrl = 'data:image/png;base64,' + png.toString('base64')
      return { items, suggestedName: `${base}.ico` }
    }

    if (target === 'icns') {
      const { largestPng } = decodeToFrames(buf, format, [])
      const img = nativeImage.createFromBuffer(largestPng)
      const src = img.getSize()
      const srcMax = Math.max(src.width, src.height)
      let sizes = [16, 32, 64, 128, 256, 512, 1024].filter((s) => s <= srcMax)
      if (!sizes.length) sizes = [Math.max(16, srcMax)] // 极小源图：单块兜底
      const chunks = sizes.map((s) => {
        const scaled = s === srcMax && s === src.width ? img : img.resize({ width: Math.round(src.width * (s / srcMax)), quality: 'best' })
        return { type: ICNS_TYPE_BY_SIZE[s], png: scaled.toPNG() }
      })
      const icns = encodeIcns(chunks)
      items.push({ name: `${base}.icns`, size: null, base64: icns.toString('base64'), dataUrl: 'data:image/png;base64,' + Buffer.from(chunks[chunks.length - 1].png).toString('base64') })
      return { items, suggestedName: `${base}.icns` }
    }

    // PNG 导出（ICO/ICNS 拆帧 或 栅格图缩放导出）
    const sizes = (args.sizes ?? [256]).filter((s) => s > 0)
    if (format === 'ico') {
      for (const e of parseIcoEntries(buf)) {
        items.push({
          name: `${base}-${e.width}x${e.height}.png`,
          size: e.width,
          base64: frameToPng(buf, e).toString('base64'),
          dataUrl: '',
        })
      }
    } else if (format === 'icns') {
      for (const c of parseIcnsChunks(buf)) {
        const d = pngDimensions(c.png)
        items.push({ name: `${base}-${d.width}x${d.height}.png`, size: d.width, base64: c.png.toString('base64'), dataUrl: '' })
      }
    } else {
      const { frames } = decodeToFrames(buf, format, sizes)
      for (const f of frames) {
        const png = nativeImage.createFromBitmap(f.bgra, { width: f.size, height: f.size }).toPNG()
        items.push({ name: `${base}-${f.size}x${f.size}.png`, size: f.size, base64: png.toString('base64'), dataUrl: '' })
      }
    }
    items.forEach((it) => {
      it.dataUrl = 'data:image/png;base64,' + it.base64
    })
    return { items, suggestedName: `${base}.png` }
  })

  ipcMain.handle(
    'iconconvert:save',
    async (_event, args: { items: { name: string; base64: string }[]; defaultDir?: string }) => {
      const win = BrowserWindow.getAllWindows()[0]
      if (args.items.length === 1) {
        const it = args.items[0]
        const ext = path.extname(it.name) || '.png'
        const result = await dialog.showSaveDialog(win, {
          defaultPath: path.join(args.defaultDir || '', it.name),
          filters:
            ext === '.ico'
              ? [{ name: '图标', extensions: ['ico'] }]
              : ext === '.icns'
                ? [{ name: 'macOS 图标', extensions: ['icns'] }]
                : [{ name: '图片', extensions: ['png'] }],
        })
        if (result.canceled || !result.filePath) return { canceled: true, saved: [] }
        fs.writeFileSync(result.filePath, Buffer.from(it.base64, 'base64'))
        return { canceled: false, saved: [result.filePath] }
      }
      // 多文件（PNG 拆帧）：选择目录后按名称写入
      const result = await dialog.showOpenDialog(win, {
        properties: ['openDirectory', 'createDirectory'],
      })
      if (result.canceled || !result.filePaths[0]) return { canceled: true, saved: [] }
      const dir = result.filePaths[0]
      const saved: string[] = []
      for (const it of args.items) {
        const target = path.join(dir, it.name)
        fs.writeFileSync(target, Buffer.from(it.base64, 'base64'))
        saved.push(target)
      }
      return { canceled: false, saved }
    },
  )
}
