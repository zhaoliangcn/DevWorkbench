import { marked } from 'marked'
import type { Tokens } from 'marked'
import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
} from 'docx'
import html2pdf from 'html2pdf.js'

interface ParsedBlock {
  type: string
  text: string
  level?: number
}

function parseMarkdownToBlocks(content: string): ParsedBlock[] {
  const tokens = marked.lexer(content)
  const blocks: ParsedBlock[] = []

  for (const token of tokens) {
    switch (token.type) {
      case 'heading': {
        const t = token as Tokens.Heading
        blocks.push({
          type: 'heading',
          text: t.text,
          level: t.depth,
        })
        break
      }
      case 'paragraph': {
        const t = token as Tokens.Paragraph
        blocks.push({ type: 'paragraph', text: t.text })
        break
      }
      case 'list': {
        const t = token as Tokens.List
        for (const item of t.items) {
          blocks.push({
            type: t.ordered ? 'orderedListItem' : 'listItem',
            text: item.text,
          })
        }
        break
      }
      case 'code': {
        const t = token as Tokens.Code
        blocks.push({ type: 'code', text: t.text })
        break
      }
      case 'blockquote': {
        const t = token as Tokens.Blockquote
        blocks.push({ type: 'blockquote', text: t.text ?? '' })
        break
      }
      case 'hr':
        blocks.push({ type: 'hr', text: '' })
        break
      case 'table': {
        const t = token as Tokens.Table
        blocks.push({ type: 'table', text: JSON.stringify(t) })
        break
      }
      default: {
        const t = token as Tokens.Generic
        if (t.text) {
          blocks.push({ type: 'paragraph', text: String(t.text) })
        }
      }
    }
  }

  return blocks
}

function inlineFormat(text: string): TextRun[] {
  const runs: TextRun[] = []
  const regex = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)/g
  let lastIndex = 0
  let match

  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      runs.push(new TextRun(text.slice(lastIndex, match.index)))
    }

    if (match[2]) {
      runs.push(new TextRun({ text: match[2], bold: true }))
    } else if (match[4]) {
      runs.push(new TextRun({ text: match[4], italics: true }))
    } else if (match[6]) {
      runs.push(new TextRun({ text: match[6], font: 'Consolas', highlight: 'lightGray' }))
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < text.length) {
    runs.push(new TextRun(text.slice(lastIndex)))
  }

  return runs.length > 0 ? runs : [new TextRun(text)]
}

export async function exportToDocx(title: string, content: string): Promise<void> {
  const blocks = parseMarkdownToBlocks(content)
  const children: (Paragraph | Table)[] = []

  children.push(
    new Paragraph({
      children: [new TextRun({ text: title, bold: true, size: 48 })],
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.CENTER,
      spacing: { after: 400 },
    })
  )

  for (const block of blocks) {
    switch (block.type) {
      case 'heading': {
        children.push(
          new Paragraph({
            children: inlineFormat(block.text),
            heading: (block.level ?? 1) === 1 ? HeadingLevel.HEADING_1 :
                     block.level === 2 ? HeadingLevel.HEADING_2 :
                     block.level === 3 ? HeadingLevel.HEADING_3 :
                     block.level === 4 ? HeadingLevel.HEADING_4 :
                     block.level === 5 ? HeadingLevel.HEADING_5 :
                     HeadingLevel.HEADING_6,
            spacing: { before: 240, after: 120 },
          })
        )
        break
      }
      case 'paragraph':
        children.push(
          new Paragraph({
            children: inlineFormat(block.text),
            spacing: { after: 120 },
          })
        )
        break
      case 'listItem':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: '\u2022 ', bold: true }), ...inlineFormat(block.text)],
            indent: { left: 720 },
            spacing: { after: 60 },
          })
        )
        break
      case 'orderedListItem':
        children.push(
          new Paragraph({
            children: inlineFormat(block.text),
            indent: { left: 720 },
            spacing: { after: 60 },
          })
        )
        break
      case 'code':
        children.push(
          new Paragraph({
            children: [
              new TextRun({
                text: block.text,
                font: 'Consolas',
                size: 20,
                highlight: 'lightGray',
              }),
            ],
            indent: { left: 360, right: 360 },
            spacing: { before: 120, after: 120 },
          })
        )
        break
      case 'blockquote':
        children.push(
          new Paragraph({
            children: inlineFormat(block.text),
            indent: { left: 720 },
            border: {
              left: { style: BorderStyle.SINGLE, size: 3, color: '6366F1' },
            },
            spacing: { before: 120, after: 120 },
          })
        )
        break
      case 'hr':
        children.push(
          new Paragraph({
            children: [new TextRun({ text: '\u2500'.repeat(50), color: 'CCCCCC' })],
            alignment: AlignmentType.CENTER,
            spacing: { before: 200, after: 200 },
          })
        )
        break
      case 'table': {
        try {
          const tableData = JSON.parse(block.text) as { header: string[]; rows: string[][] }
          if (tableData.header && tableData.rows) {
            const rows = [
              new TableRow({
                children: tableData.header.map(
                  (cell) =>
                    new TableCell({
                      children: [new Paragraph({ children: [new TextRun({ text: cell, bold: true })] })],
                      shading: { fill: 'F0F0F0' },
                    })
                ),
              }),
              ...tableData.rows.map(
                (row) =>
                  new TableRow({
                    children: row.map(
                      (cell) =>
                        new TableCell({
                          children: [new Paragraph({ children: [new TextRun(cell)] })],
                        })
                    ),
                  })
              ),
            ]
            children.push(
              new Table({
                rows,
                width: { size: 100, type: WidthType.PERCENTAGE },
              })
            )
          }
        } catch {
          children.push(new Paragraph({ children: [new TextRun(block.text)] }))
        }
        break
      }
      default:
        children.push(new Paragraph({ children: [new TextRun(block.text)] }))
    }
  }

  const doc = new Document({
    sections: [
      {
        properties: {},
        children,
      },
    ],
  })

  const blob = await Packer.toBlob(doc)
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${title}.docx`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function exportToPdf(title: string, content: string): Promise<void> {
  const htmlContent = `
    <div style="
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      line-height: 1.8;
      color: #1a1a2e;
      padding: 40px;
      max-width: 800px;
      margin: 0 auto;
    ">
      <h1 style="
        font-size: 28px;
        font-weight: 700;
        text-align: center;
        margin-bottom: 32px;
        color: #0f0f23;
        border-bottom: 2px solid #6366f1;
        padding-bottom: 16px;
      ">${title}</h1>
      ${marked.parse(content)}
    </div>
  `

  const style = `
    h1 { font-size: 24px; font-weight: 700; margin: 24px 0 16px; color: #0f0f23; }
    h2 { font-size: 20px; font-weight: 600; margin: 20px 0 12px; color: #1a1a2e; }
    h3 { font-size: 18px; font-weight: 600; margin: 16px 0 10px; }
    h4 { font-size: 16px; font-weight: 600; margin: 14px 0 8px; }
    h5 { font-size: 14px; font-weight: 600; margin: 12px 0 8px; }
    h6 { font-size: 13px; font-weight: 600; margin: 10px 0 6px; }
    p { margin: 12px 0; }
    code {
      background: #f5f5f5;
      padding: 2px 6px;
      border-radius: 4px;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
    }
    pre {
      background: #f5f5f5;
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      font-family: 'Consolas', 'Monaco', monospace;
      font-size: 0.9em;
      line-height: 1.5;
    }
    pre code {
      background: none;
      padding: 0;
    }
    blockquote {
      border-left: 4px solid #6366f1;
      padding-left: 16px;
      margin: 16px 0;
      color: #555;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
    }
    th, td {
      border: 1px solid #ddd;
      padding: 8px 12px;
      text-align: left;
    }
    th {
      background: #f0f0f0;
      font-weight: 600;
    }
    ul, ol {
      padding-left: 24px;
      margin: 12px 0;
    }
    li {
      margin: 4px 0;
    }
    hr {
      border: none;
      border-top: 1px solid #ddd;
      margin: 24px 0;
    }
    a {
      color: #6366f1;
      text-decoration: none;
    }
    img {
      max-width: 100%;
      height: auto;
    }
  `

  const element = document.createElement('div')
  element.innerHTML = `<style>${style}</style>${htmlContent}`
  document.body.appendChild(element)

  const opt = {
    margin: [10, 10, 10, 10] as [number, number, number, number],
    filename: `${title}.pdf`,
    image: { type: 'jpeg' as const, quality: 0.98 },
    html2canvas: { scale: 2, useCORS: true },
    jsPDF: { unit: 'mm' as const, format: 'a4' as const, orientation: 'portrait' as const },
  }

  try {
    await html2pdf().set(opt).from(element).save()
  } finally {
    document.body.removeChild(element)
  }
}
