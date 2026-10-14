// 工具箱：PDF 纯函数引擎测试（src/workspaces/toolbox/tools/pure/pdf.ts）
// 覆盖：页码范围解析、合并/拆分字节级往返（pdf-lib 构造样例文档）、输出命名
import { describe, it, expect } from 'vitest'
import { PDFDocument } from 'pdf-lib'
import {
  parsePageRanges,
  pdfPageCount,
  mergePdfBytes,
  splitPdfBytes,
  splitFileNames,
} from '../src/workspaces/toolbox/tools/pure/pdf'

/** 构造 n 页样例 PDF（每页有独立文本可辨识） */
async function makePdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) {
    const page = doc.addPage([300, 300])
    page.drawText(`p${i + 1}`, { x: 50, y: 150, size: 24 })
  }
  return doc.save()
}

describe('parsePageRanges', () => {
  it('区间与单页混排，返回 0 起页索引组', () => {
    expect(parsePageRanges('1-3,5,7-9', 10)).toEqual([[0, 1, 2], [4], [6, 7, 8]])
  })

  it('支持中文逗号与空白', () => {
    expect(parsePageRanges('1 - 2，4', 5)).toEqual([[0, 1], [3]])
  })

  it('倒序区间自动交换', () => {
    expect(parsePageRanges('5-3', 10)).toEqual([[2, 3, 4]])
  })

  it('空输入报错', () => {
    expect(() => parsePageRanges('  ', 5)).toThrow('页码范围不能为空')
  })

  it('越界页码报错', () => {
    expect(() => parsePageRanges('1,11', 10)).toThrow('超出总页数')
    expect(() => parsePageRanges('0', 10)).toThrow('超出总页数')
  })

  it('非法输入报错', () => {
    expect(() => parsePageRanges('abc', 10)).toThrow('无法识别的页码范围')
    expect(() => parsePageRanges('1--3', 10)).toThrow('无法识别的页码范围')
  })
})

describe('mergePdfBytes / splitPdfBytes（字节级往返）', () => {
  it('合并两个 2 页文档 → 4 页', async () => {
    const merged = await mergePdfBytes([await makePdf(2), await makePdf(2)])
    expect(await pdfPageCount(merged)).toBe(4)
  })

  it('单个输入报错', async () => {
    await expect(mergePdfBytes([await makePdf(1)])).rejects.toThrow('至少提供两个')
  })

  it('拆分 4 页为 3+1，输出页数与分组一致', async () => {
    const src = await makePdf(4)
    const groups = parsePageRanges('1-3,4', 4)
    const outputs = await splitPdfBytes(src, groups)
    expect(outputs).toHaveLength(2)
    expect(await pdfPageCount(outputs[0])).toBe(3)
    expect(await pdfPageCount(outputs[1])).toBe(1)
  })

  it('每页一文件拆分（each 模式分组）', async () => {
    const src = await makePdf(3)
    const outputs = await splitPdfBytes(src, Array.from({ length: 3 }, (_, i) => [i]))
    expect(outputs).toHaveLength(3)
    for (const out of outputs) expect(await pdfPageCount(out)).toBe(1)
  })

  it('空分组与越界分组报错', async () => {
    const src = await makePdf(2)
    await expect(splitPdfBytes(src, [])).rejects.toThrow('没有可输出的页码分组')
    await expect(splitPdfBytes(src, [[5]])).rejects.toThrow('超出范围')
    await expect(splitPdfBytes(src, [[]])).rejects.toThrow('分组不能为空')
  })

  it('合并后再拆分：内容往返无损（页数守恒）', async () => {
    const a = await makePdf(3)
    const b = await makePdf(2)
    const merged = await mergePdfBytes([a, b])
    const outputs = await splitPdfBytes(merged, parsePageRanges('1-3,4-5', 5))
    expect(await pdfPageCount(outputs[0])).toBe(3)
    expect(await pdfPageCount(outputs[1])).toBe(2)
  })
})

describe('splitFileNames', () => {
  it('单页与区间命名，按总页数补零', () => {
    const groups = parsePageRanges('1,3-4,10', 10)
    expect(splitFileNames('doc', groups, 10)).toEqual(['doc-p01.pdf', 'doc-p03-p04.pdf', 'doc-p10.pdf'])
  })
})
