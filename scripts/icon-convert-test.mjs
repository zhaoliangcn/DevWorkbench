// 图标转换引擎功能验证（electron 环境运行）：
//   npx electron scripts/icon-convert-test.mjs
// 覆盖：toBitmap alpha 语义、PNG→ICO 编码结构与往返、真实 ICO 拆帧、ICNS 编码与解析
import { app, nativeImage } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'
import {
  detectFormat,
  parseIcoEntries,
  parseIcnsChunks,
  decodeToFrames,
  frameToPng,
  encodeIco,
  encodeIcns,
} from '../dist-electron/ipc/icon-convert.js'

let pass = 0
let fail = 0
function check(name, cond, detail = '') {
  if (cond) {
    pass++
    console.log(`  PASS ${name}${detail ? ' — ' + detail : ''}`)
  } else {
    fail++
    console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`)
  }
}

/* ---- 最小 PNG 编码器（RGBA filter 0） ---- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c
  }
  return t
})()
function crc32(buf) {
  let c = -1
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}
function chunk(type, data) {
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  out.write(type, 4, 'ascii')
  data.copy(out, 8)
  out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length)
  return out
}
function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    rgba.copy(raw, y * (1 + width * 4) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))])
}

app.whenReady().then(async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'icon-convert-test-'))
  try {
    /* 1. toBitmap alpha 语义：合成 2x2 PNG，pixel(0,0)=RGBA(255,0,0,128) */
    console.log('[1] nativeImage.toBitmap alpha 语义')
    const rgba = Buffer.alloc(2 * 2 * 4)
    rgba[0] = 255 // R
    rgba[3] = 128 // A
    const probe = encodePng(2, 2, rgba)
    const img = nativeImage.createFromBuffer(probe)
    const bmp = img.toBitmap() // BGRA
    const r = bmp[2]
    const a = bmp[3]
    const isPremultiplied = Math.abs(r - Math.round((255 * 128) / 255)) <= 1 && r < 200
    console.log(`      toBitmap 返回 R=${r} A=${a} → ${isPremultiplied ? '预乘 alpha' : '直通 alpha'}`)
    check('PNG 探针可解码', !img.isEmpty(), `R=${r} A=${a}`)
    check('引擎的反预乘假设正确', isPremultiplied || r === 255, '预乘→反预乘可还原；直通→clamp 不变')

    /* 2. PNG → ICO：结构 + 往返 */
    console.log('[2] PNG → ICO 编码与往返')
    const srcPng = fs.readFileSync('icons/devworkbench.png')
    check('源格式识别 PNG', detectFormat(srcPng) === 'png')
    const { frames, largestPng } = decodeToFrames(srcPng, 'png', [16, 32, 48, 256])
    check('生成 4 个尺寸帧', frames.length === 4 && frames.map((f) => f.size).join(',') === '16,32,48,256')
    check('最大帧 PNG 有效', largestPng.subarray(1, 4).toString('ascii') === 'PNG')
    const ico = encodeIco(frames)
    fs.writeFileSync(path.join(tmp, 'test.ico'), ico)
    const entries = parseIcoEntries(ico)
    check('ICO 目录条目数', entries.length === 4, entries.map((e) => e.width).join('/'))
    let offsetsOk = true
    let expectOff = 6 + entries.length * 16
    for (const e of entries) {
      if (e.offset !== expectOff) offsetsOk = false
      expectOff += e.bytes
    }
    check('ICO 帧偏移连续无重叠', offsetsOk)
    check('ICO 总长一致', expectOff === ico.length)
    let roundtripOk = true
    for (const e of entries) {
      const png = frameToPng(ico, e)
      if (png.subarray(12, 16).toString('ascii') !== 'IHDR') roundtripOk = false
      else if (png.readUInt32BE(16) !== e.width || png.readUInt32BE(20) !== e.width) roundtripOk = false
    }
    check('ICO 各帧往返尺寸一致', roundtripOk)
    check('256px 为 BMP 帧（resedit 兼容）', entries[entries.length - 1].png === false)

    /* 3. 真实 ICO 拆帧（用户重新生成的 devworkbench.ico） */
    console.log('[3] 真实 ICO 解析')
    const realIco = fs.readFileSync('icons/devworkbench.ico')
    check('识别为 ICO', detectFormat(realIco) === 'ico')
    const realEntries = parseIcoEntries(realIco)
    console.log('      条目:', realEntries.map((e) => `${e.width}x${e.height}@${e.bitCount}${e.png ? '(png)' : ''}`).join('  '))
    let realOk = true
    const realErrs = []
    for (const e of realEntries) {
      try {
        const png = frameToPng(realIco, e)
        if (png.readUInt32BE(16) !== e.width) realOk = false
      } catch (err) {
        realOk = false
        realErrs.push(`${e.width}px: ${err.message}`)
      }
    }
    check('真实 ICO 全部帧可解码', realOk, realErrs.join('; ') || `${realEntries.length} 帧`)

    /* 4. PNG → ICNS */
    console.log('[4] PNG → ICNS 编码与解析')
    const srcSize = nativeImage.createFromBuffer(srcPng).getSize()
    const icnsSizes = [16, 32, 64, 128, 256].filter((s) => s <= Math.max(srcSize.width, srcSize.height))
    const { frames: icnsFrames } = decodeToFrames(srcPng, 'png', icnsSizes)
    const typeBySize = { 16: 'icp4', 32: 'icp5', 64: 'ic12', 128: 'ic07', 256: 'ic08' }
    const icns = encodeIcns(icnsFrames.map((f) => ({ type: typeBySize[f.size], png: frameToPngOf(f) })))
    fs.writeFileSync(path.join(tmp, 'test.icns'), icns)
    const chunks = parseIcnsChunks(icns)
    check('ICNS 头与块解析', icns.subarray(0, 4).toString('ascii') === 'icns' && chunks.length === icnsSizes.length, `${chunks.length} 块`)
    check('ICNS 块均为 PNG', chunks.every((c) => c.png.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))))
    function frameToPngOf(f) {
      return nativeImage.createFromBitmap(f.bgra, { width: f.size, height: f.size }).toPNG()
    }
  } finally {
    console.log(`\n结果: ${pass} PASS, ${fail} FAIL  (tmp: ${tmp})`)
    app.exit(fail > 0 ? 1 : 0)
  }
})
