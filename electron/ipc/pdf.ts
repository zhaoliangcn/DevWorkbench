import { dialog, ipcMain, nativeImage, BrowserWindow } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

// 工具箱：PDF 工具 IO 壳（pdf:*）
// 合并/拆分引擎唯一实现位于渲染层 src/workspaces/toolbox/tools/pure/pdf.ts
// （electron tsconfig rootDir 限制无法跨包 import，引擎随渲染层执行）；
// 本文件只负责会话绑定的文件选择、字节读取与落盘。
// 图片→PDF 因需 nativeImage 转码（WebP/GIF/BMP）仍在主进程用 pdf-lib 完成。

const MAX_PDF_BYTES = 256 * 1024 * 1024 // 单个 PDF 上限
const MAX_IMAGE_BYTES = 64 * 1024 * 1024 // 单张图片上限
const MAX_READ_BYTES = 256 * 1024 * 1024 // pdf:readBytes 返回字节上限
const FILE_SAVE_EXTENSIONS = new Set(['.pdf', '.png', '.jpg', '.jpeg', '.webp'])
const A4: { width: number; height: number } = { width: 595.28, height: 841.89 }

/** 会话绑定：所有文件操作只接受 pdf:pick* 最近返回的路径（防任意路径读写） */
const sessionPaths = new Set<string>()

function trackPath(p: string) {
  sessionPaths.add(path.resolve(p))
}

/** 校验路径来自本会话的 pick 对话框，防止渲染层伪造任意路径 */
function assertSessionPath(p: unknown): string {
  const abs = path.resolve(String(p ?? ''))
  if (!sessionPaths.has(abs)) throw new Error('请先通过选择对话框添加文件')
  return abs
}

/** 魔数判断图片格式（pdf-lib 仅原生支持 JPEG/PNG，其余先转 PNG） */
function detectImageFormat(buf: Buffer): 'png' | 'jpeg' | 'gif' | 'bmp' | 'webp' | 'unknown' {
  if (buf.length < 12) return 'unknown'
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'png'
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpeg'
  if (buf.subarray(0, 3).toString('ascii') === 'GIF') return 'gif'
  if (buf[0] === 0x42 && buf[1] === 0x4d) return 'bmp'
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp'
  return 'unknown'
}

/** 单张图片 → { png 或 jpg 原始字节 }，pdf-lib 不支持的格式经 nativeImage 转码为 PNG */
function imageBytesForEmbed(buf: Buffer, format: ReturnType<typeof detectImageFormat>): { bytes: Uint8Array; type: 'png' | 'jpg' } {
  if (format === 'png') return { bytes: buf, type: 'png' }
  if (format === 'jpeg') return { bytes: buf, type: 'jpg' }
  const img = nativeImage.createFromBuffer(buf)
  if (img.isEmpty()) throw new Error('图片无法解码')
  return { bytes: new Uint8Array(img.toPNG()), type: 'png' }
}

/** 目录 + 白名单文件名批量落盘（渲染层产物，名称必须归一防穿越） */
async function saveFilesToDirectory(items: { name: string; base64: string }[]): Promise<{ canceled: boolean; saved: string[] }> {
  const win = BrowserWindow.getAllWindows()[0]
  if (!Array.isArray(items) || !items.length) throw new Error('没有可保存的文件')
  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { canceled: true, saved: [] }
  const dir = path.resolve(result.filePaths[0])
  const lc = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const saved: string[] = []
  for (const it of items) {
    const name = path.basename(String(it?.name ?? ''))
    if (!name || name.startsWith('.') || !FILE_SAVE_EXTENSIONS.has(path.extname(name).toLowerCase())) {
      throw new Error('非法导出文件名')
    }
    const target = path.resolve(dir, name)
    if (lc(target) !== lc(dir) && !lc(target).startsWith(lc(dir) + path.sep)) {
      throw new Error('导出路径越界')
    }
    fs.writeFileSync(target, Buffer.from(String(it?.base64 ?? ''), 'base64'))
    saved.push(target)
  }
  return { canceled: false, saved }
}

export function registerPdfIpc() {
  // 多选 PDF（合并用）
  ipcMain.handle('pdf:pickFiles', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    const files = result.filePaths.map((p) => {
      trackPath(p)
      return { path: p, name: path.basename(p), size: fs.statSync(p).size }
    })
    return { canceled: false, files }
  })

  // 单选 PDF（拆分/文本提取/PDF转图片用），附带页数
  ipcMain.handle('pdf:pickPdf', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile'],
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    })
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath) return { canceled: true }
    trackPath(filePath)
    let pageCount: number | null
    try {
      const stat = fs.statSync(filePath)
      if (!stat.isFile() || stat.size > MAX_PDF_BYTES) throw new Error('size')
      const doc = await PDFDocument.load(new Uint8Array(fs.readFileSync(filePath)), {
        ignoreEncryption: true,
        updateMetadata: false,
      })
      pageCount = doc.getPageCount()
    } catch {
      pageCount = null // 页数读取失败不阻塞选择（如超大文件），操作时再报错
    }
    return { canceled: false, path: filePath, name: path.basename(filePath), size: fs.statSync(filePath).size, pageCount }
  })

  // 多选图片（图片转 PDF 用）
  ipcMain.handle('pdf:pickImages', async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = await dialog.showOpenDialog(win, {
      properties: ['openFile', 'multiSelections'],
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
    })
    if (result.canceled || !result.filePaths.length) return { canceled: true }
    const files = result.filePaths.map((p) => {
      trackPath(p)
      return { path: p, name: path.basename(p), size: fs.statSync(p).size }
    })
    return { canceled: false, files }
  })

  // 渲染进程引擎用：会话绑定读取 PDF 原始字节（base64）
  ipcMain.handle('pdf:readBytes', async (_event, args: { path: string }) => {
    const abs = assertSessionPath(args?.path)
    const stat = fs.statSync(abs)
    if (!stat.isFile()) throw new Error('文件不存在')
    if (stat.size > MAX_READ_BYTES) throw new Error('文件超过 256MB 上限')
    return { base64: fs.readFileSync(abs).toString('base64'), size: stat.size }
  })

  // 渲染进程引擎产物落盘：单个 PDF（保存对话框，suggestedName 只取 basename 且强制 .pdf）
  ipcMain.handle('pdf:savePdf', async (_event, args: { base64: string; suggestedName: string }) => {
    const win = BrowserWindow.getAllWindows()[0]
    const name = path.basename(String(args?.suggestedName ?? ''))
    if (!name || !name.toLowerCase().endsWith('.pdf')) throw new Error('非法保存文件名')
    const result = await dialog.showSaveDialog(win, {
      defaultPath: name,
      filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
    })
    if (result.canceled || !result.filePath) return { canceled: true }
    fs.writeFileSync(result.filePath, Buffer.from(String(args?.base64 ?? ''), 'base64'))
    return { canceled: false, saved: result.filePath }
  })

  // 渲染进程引擎产物落盘：多个文件（PDF/图片，目录对话框 + 文件名白名单防穿越）
  ipcMain.handle('pdf:saveFiles', async (_event, args: { items: { name: string; base64: string }[] }) =>
    saveFilesToDirectory(Array.isArray(args?.items) ? args.items : []),
  )

  // 图片 → PDF：按传入顺序每图一页（WebP/GIF/BMP 经 nativeImage 转码）
  ipcMain.handle(
    'pdf:imagesToPdf',
    async (_event, args: { paths: string[]; pageSize: 'auto' | 'a4' }) => {
      const paths = Array.isArray(args?.paths) ? args.paths.map(assertSessionPath) : []
      if (!paths.length) throw new Error('请先选择图片')
      const out = await PDFDocument.create()
      for (const p of paths) {
        const stat = fs.statSync(p)
        if (stat.size > MAX_IMAGE_BYTES) throw new Error(`图片超过 64MB 上限：${path.basename(p)}`)
        const buf = fs.readFileSync(p)
        const format = detectImageFormat(buf)
        if (format === 'unknown') throw new Error(`无法识别的图片格式：${path.basename(p)}`)
        const embed = imageBytesForEmbed(buf, format)
        const embedded = embed.type === 'png' ? await out.embedPng(embed.bytes) : await out.embedJpg(embed.bytes)
        if (args.pageSize === 'a4') {
          const page = out.addPage([A4.width, A4.height])
          const scale = Math.min(A4.width / embedded.width, A4.height / embedded.height)
          const w = embedded.width * scale
          const h = embedded.height * scale
          page.drawImage(embedded, { x: (A4.width - w) / 2, y: (A4.height - h) / 2, width: w, height: h })
        } else {
          const page = out.addPage([embedded.width, embedded.height])
          page.drawImage(embedded, { x: 0, y: 0, width: embedded.width, height: embedded.height })
        }
      }
      const bytes = await out.save()
      const win = BrowserWindow.getAllWindows()[0]
      const suggested = path.basename(paths[0]).replace(/\.(png|jpe?g|webp|gif|bmp)$/i, '') + '.pdf'
      const result = await dialog.showSaveDialog(win, {
        defaultPath: suggested,
        filters: [{ name: 'PDF 文件', extensions: ['pdf'] }],
      })
      if (result.canceled || !result.filePath) return { canceled: true }
      fs.writeFileSync(result.filePath, bytes)
      return { canceled: false, saved: result.filePath, pages: out.getPageCount() }
    },
  )
}
