/**
 * PDF 合并/拆分纯函数引擎（P0 三件套抽取，设计文档附录 C.3 约定）。
 *
 * 字节进 / 字节出，无 IO、无 IPC、无 Electron 依赖，是本能力的唯一实现源：
 * - 渲染层 PdfTool 经 pdf:readBytes 取字节后在本引擎完成合并/拆分，再经
 *   pdf:savePdf / pdf:savePdfs 落盘；
 * - 主进程仅保留 IO 壳（electron tsconfig rootDir 限制无法反向 import src/，
 *   与 pure/base64.ts「两侧成对」不同，本文件引擎较重，故引擎只此一份，
 *   由渲染层执行 —— 与知识库导出 html2pdf.js 同思路）。
 * - 大小上限等文件级防护在主进程 IO 壳中执行。
 */

import { PDFDocument } from 'pdf-lib'

/**
 * 解析页码范围表达式 "1-3,5,7-9" → 每组输出的 0 起页索引数组。
 * 支持中文逗号、区间内空白与倒序区间（自动交换）；越界、空组、非法输入报错。
 */
export function parsePageRanges(input: string, totalPages: number): number[][] {
  const groups = input
    .split(/[,，]/)
    .map((g) => g.trim())
    .filter((g) => g.length > 0)
  if (!groups.length) throw new Error('页码范围不能为空')
  return groups.map((g) => {
    const m = /^(\d+)\s*[-–]\s*(\d+)$/.exec(g)
    if (m) {
      let start = Number(m[1])
      let end = Number(m[2])
      if (start < 1 || end > totalPages) throw new Error(`范围 ${g} 超出总页数 ${totalPages}`)
      if (start > end) [start, end] = [end, start]
      const pages: number[] = []
      for (let p = start; p <= end; p++) pages.push(p - 1)
      return pages
    }
    if (!/^\d+$/.test(g)) throw new Error(`无法识别的页码范围：${g}`)
    const p = Number(g)
    if (p < 1 || p > totalPages) throw new Error(`页码 ${p} 超出总页数 ${totalPages}`)
    return [p - 1]
  })
}

/** 加载 PDF（忽略加密标志），加密文档抛错 —— 加密流无法正确复制/重写 */
async function loadDoc(data: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(data, { ignoreEncryption: true, updateMetadata: false })
  if (doc.isEncrypted) throw new Error('暂不支持加密 PDF，请先解密')
  return doc
}

/** 读取 PDF 页数（完整解析；调用方负责字节大小上限） */
export async function pdfPageCount(data: Uint8Array): Promise<number> {
  return (await loadDoc(data)).getPageCount()
}

/** 按传入顺序合并多个 PDF，返回合并后的字节 */
export async function mergePdfBytes(inputs: Uint8Array[]): Promise<Uint8Array> {
  if (inputs.length < 2) throw new Error('请至少提供两个 PDF 文件')
  const out = await PDFDocument.create()
  for (const data of inputs) {
    const src = await loadDoc(data)
    const pages = await out.copyPages(src, src.getPageIndices())
    pages.forEach((page) => out.addPage(page))
  }
  return out.save()
}

/**
 * 按分组拆分 PDF，groups 为 0 起页索引数组（如 parsePageRanges 的输出），
 * 返回字节与 groups 一一对应。
 */
export async function splitPdfBytes(data: Uint8Array, groups: number[][]): Promise<Uint8Array[]> {
  if (!groups.length) throw new Error('没有可输出的页码分组')
  const src = await loadDoc(data)
  const total = src.getPageCount()
  if (total < 1) throw new Error('PDF 没有可拆分的页面')
  const outputs: Uint8Array[] = []
  for (const group of groups) {
    if (!group.length) throw new Error('页码分组不能为空')
    if (group.some((p) => !Number.isInteger(p) || p < 0 || p >= total)) {
      throw new Error(`页码分组超出范围（总页数 ${total}）`)
    }
    const doc = await PDFDocument.create()
    const pages = await doc.copyPages(src, group)
    pages.forEach((page) => doc.addPage(page))
    outputs.push(await doc.save())
  }
  return outputs
}

/** 拆分输出文件名：单页 p001，区间 p001-p003，按总页数补零对齐 */
export function splitFileNames(base: string, groups: number[][], totalPages: number): string[] {
  const pad = String(Math.max(totalPages, 1)).length
  return groups.map((group) => {
    const from = String(group[0] + 1).padStart(pad, '0')
    const to = String(group[group.length - 1] + 1).padStart(pad, '0')
    return group.length === 1 ? `${base}-p${from}.pdf` : `${base}-p${from}-p${to}.pdf`
  })
}
