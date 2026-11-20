/** Word (.docx) 导入：解析为 Markdown 文本 */
export async function docxToMarkdown(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()
  // 按需加载解析库，避免知识库首屏体积膨胀
  const mammoth = await import('mammoth/mammoth.browser.js')
  const result = await mammoth.convertToMarkdown({ arrayBuffer })
  return normalizeMarkdown(result.value)
}

function normalizeMarkdown(markdown: string): string {
  return markdown
    .replace(/\r\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}
