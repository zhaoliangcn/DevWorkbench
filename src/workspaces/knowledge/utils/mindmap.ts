import type { MindMapNode } from '../../../types'

export function parseHeadings(markdown: string): MindMapNode | null {
  const lines = markdown.split('\n')
  const headingRegex = /^(#{1,6})\s+(.+)$/

  const stack: { node: MindMapNode; level: number }[] = []
  let root: MindMapNode | null = null
  let idCounter = 0

  for (const line of lines) {
    const match = line.match(headingRegex)
    if (!match) continue

    const level = match[1].length
    const label = match[2].trim()
    if (!label) continue

    const node: MindMapNode = {
      id: `mm-${idCounter++}`,
      label,
      level,
      children: [],
    }

    if (!root) {
      root = node
      stack.push({ node, level })
      continue
    }

    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop()
    }

    if (stack.length === 0) {
      root.children.push(node)
    } else {
      stack[stack.length - 1].node.children.push(node)
    }

    stack.push({ node, level })
  }

  return root
}
