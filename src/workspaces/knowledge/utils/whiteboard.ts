/**
 * 白板核心纯函数（附录 B.5.3 自实现 SVG 白板）。
 *
 * 设计约束：
 * - 零依赖：vitest 为 node 默认环境（无 DOMParser），SVG 解析用正则实现；
 * - 自控格式：所有可编辑元素带 data-wb-tool / data-id 属性，解析时只认这两种
 *   属性齐备的元素，因此 defs/marker 等辅助节点天然被跳过；
 * - 画布固定 1600x1000（viewBox 不随内容变化），坐标往返严格无损；
 * - pen 路径：RDP 简化 + 二次贝塞尔中点平滑，锚点即简化后的采样点，
 *   解析时取 M/L/Q 段的锚点即可还原 points。
 */

export type WbTool = 'pen' | 'line' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'eraser'

export interface WbBase {
  id: string
  stroke: string
  strokeWidth: number
}

export interface WbPen extends WbBase {
  tool: 'pen'
  points: [number, number][]
}

export interface WbLine extends WbBase {
  tool: 'line'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface WbArrow extends WbBase {
  tool: 'arrow'
  x1: number
  y1: number
  x2: number
  y2: number
}

export interface WbRect extends WbBase {
  tool: 'rect'
  x: number
  y: number
  w: number
  h: number
}

export interface WbEllipse extends WbBase {
  tool: 'ellipse'
  cx: number
  cy: number
  rx: number
  ry: number
}

export interface WbText extends WbBase {
  tool: 'text'
  x: number
  y: number
  text: string
  fontSize: number
}

export type WbElement = WbPen | WbLine | WbArrow | WbRect | WbEllipse | WbText

/** 固定虚拟画布尺寸（保存的 SVG viewBox 与编辑器窗口一致） */
export const WB_W = 1600
export const WB_H = 1000

/** 生成元素 id（时间戳 36 进制 + 随机尾，避免依赖 crypto） */
export function newId(): string {
  return `e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/* ---------- pen 路径：RDP 简化 + 中点平滑 ---------- */

function perpDist(
  p: [number, number],
  a: [number, number],
  b: [number, number]
): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2))
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

/** Ramer–Douglas–Peucker 简化 */
export function simplify(points: [number, number][], tolerance = 1.2): [number, number][] {
  if (points.length <= 2) return points.slice()
  const a = points[0]
  const b = points[points.length - 1]
  let maxDist = 0
  let idx = 0
  for (let i = 1; i < points.length - 1; i++) {
    const d = perpDist(points[i], a, b)
    if (d > maxDist) {
      maxDist = d
      idx = i
    }
  }
  if (maxDist > tolerance) {
    const left = simplify(points.slice(0, idx + 1), tolerance)
    const right = simplify(points.slice(idx), tolerance)
    return left.slice(0, -1).concat(right)
  }
  return [a, b]
}

function fmt(n: number): string {
  return String(Math.round(n * 10) / 10)
}

/**
 * 采样点 → 平滑 path d。
 * 结构固定为 M p0 [Q pi mid(pi,pi+1)]* L pn，解析端按命令拆段取锚点。
 */
export function penPath(points: [number, number][]): string {
  if (points.length === 0) return ''
  const pts = simplify(points)
  if (pts.length === 1) return `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`
  let d = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2
    const my = (pts[i][1] + pts[i + 1][1]) / 2
    d += ` Q ${fmt(pts[i][0])} ${fmt(pts[i][1])} ${fmt(mx)} ${fmt(my)}`
  }
  const last = pts[pts.length - 1]
  d += ` L ${fmt(last[0])} ${fmt(last[1])}`
  return d
}

/** 解析 path d 为锚点序列（M/L 起点、Q 控制点；中点平滑的 Q 控制点即原始锚点） */
export function parsePathD(d: string): [number, number][] {
  const pts: [number, number][] = []
  const segRe = /([MLQ])([^MLQ]*)/g
  let m: RegExpExecArray | null
  while ((m = segRe.exec(d)) !== null) {
    const nums = m[2].match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? []
    if (m[1] === 'M' || m[1] === 'L') {
      if (nums.length >= 2) pts.push([nums[0], nums[1]])
    } else if (m[1] === 'Q') {
      // Q cx cy x y —— 控制点是 penPath 平滑时保留的原锚点
      if (nums.length >= 4) pts.push([nums[0], nums[1]])
    }
  }
  return pts
}

/* ---------- 序列化 / 解析（正则实现，node 环境无 DOMParser） ---------- */

const ARROW_DEFS =
  '<defs><marker id="wb-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" ' +
  'markerWidth="7" markerHeight="7" orient="auto-start-reverse">' +
  '<path d="M0,0 L10,5 L0,10 z" fill="context-stroke"/></marker></defs>'

function escAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')
}

function escText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function unesc(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
}

function elementToSvgString(el: WbElement): string {
  const id = ` data-wb-tool="${el.tool}" data-id="${escAttr(el.id)}"`
  const sw = ` stroke-width="${el.strokeWidth}"`
  switch (el.tool) {
    case 'pen':
      return (
        `<path d="${escAttr(penPath(el.points))}" fill="none" stroke="${el.stroke}"${sw}` +
        ` stroke-linecap="round" stroke-linejoin="round"${id}/>`
      )
    case 'line':
      return (
        `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}"` +
        ` stroke="${el.stroke}"${sw} stroke-linecap="round"${id}/>`
      )
    case 'arrow':
      return (
        `<line x1="${el.x1}" y1="${el.y1}" x2="${el.x2}" y2="${el.y2}"` +
        ` stroke="${el.stroke}"${sw} stroke-linecap="round" marker-end="url(#wb-arrow-head)"${id}/>`
      )
    case 'rect':
      return (
        `<rect x="${el.x}" y="${el.y}" width="${el.w}" height="${el.h}" rx="4"` +
        ` fill="none" stroke="${el.stroke}"${sw}${id}/>`
      )
    case 'ellipse':
      return (
        `<ellipse cx="${el.cx}" cy="${el.cy}" rx="${el.rx}" ry="${el.ry}"` +
        ` fill="none" stroke="${el.stroke}"${sw}${id}/>`
      )
    case 'text':
      return (
        `<text x="${el.x}" y="${el.y}" font-size="${el.fontSize}" fill="${el.stroke}"${id}>` +
        `${escText(el.text)}</text>`
      )
  }
}

/** 元素数组 → 完整 SVG 字符串（固定 1600x1000 viewBox） */
export function elementsToSvg(elements: WbElement[]): string {
  const body = elements.map(elementToSvgString).join('\n')
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WB_W} ${WB_H}"` +
    ` width="${WB_W}" height="${WB_H}">\n${ARROW_DEFS}\n${body}\n</svg>`
  )
}

interface ParsedAttrs {
  [key: string]: string
}

function parseAttrs(raw: string): ParsedAttrs {
  const attrs: ParsedAttrs = {}
  const re = /([\w:-]+)="([^"]*)"/g
  let m: RegExpExecArray | null
  while ((m = re.exec(raw)) !== null) attrs[m[1]] = m[2]
  return attrs
}

function num(v: string | undefined, fallback = 0): number {
  const n = v === undefined ? NaN : parseFloat(v)
  return Number.isFinite(n) ? n : fallback
}

/** SVG 字符串 → 元素数组；只解析带 data-wb-tool 的元素，按原文位置排序 */
export function svgToElements(svg: string): WbElement[] {
  const found: { index: number; el: WbElement }[] = []

  // 成对 text 标签（其内容已转义，不含 '<'，不会干扰下方自闭合匹配）
  const textRe = /<text\b([^>]*)>([\s\S]*?)<\/text>/g
  let m: RegExpExecArray | null
  while ((m = textRe.exec(svg)) !== null) {
    const attrs = parseAttrs(m[1])
    if (attrs['data-wb-tool'] !== 'text') continue
    found.push({
      index: m.index,
      el: {
        tool: 'text',
        id: attrs['data-id'] ?? newId(),
        stroke: attrs.fill ?? attrs.stroke ?? '#cdd6f4',
        strokeWidth: num(attrs['stroke-width'], 2),
        x: num(attrs.x),
        y: num(attrs.y),
        fontSize: num(attrs['font-size'], 16),
        text: unesc(m[2]),
      },
    })
  }

  // 自闭合标签（defs/marker 内的 path 无 data-wb-tool，自然跳过）
  const selfRe = /<(path|line|rect|ellipse)\b([^>]*?)\/>/g
  while ((m = selfRe.exec(svg)) !== null) {
    const tag = m[1]
    const attrs = parseAttrs(m[2])
    const tool = attrs['data-wb-tool']
    if (!tool) continue
    const base = {
      id: attrs['data-id'] ?? newId(),
      stroke: attrs.stroke ?? '#cdd6f4',
      strokeWidth: num(attrs['stroke-width'], 2),
    }
    if (tag === 'path' && tool === 'pen') {
      found.push({
        index: m.index,
        el: { ...base, tool: 'pen', points: parsePathD(attrs.d ?? '') },
      })
    } else if (tag === 'line' && (tool === 'line' || tool === 'arrow')) {
      found.push({
        index: m.index,
        el: {
          ...base,
          tool,
          x1: num(attrs.x1),
          y1: num(attrs.y1),
          x2: num(attrs.x2),
          y2: num(attrs.y2),
        },
      })
    } else if (tag === 'rect' && tool === 'rect') {
      found.push({
        index: m.index,
        el: {
          ...base,
          tool: 'rect',
          x: num(attrs.x),
          y: num(attrs.y),
          w: num(attrs.width),
          h: num(attrs.height),
        },
      })
    } else if (tag === 'ellipse' && tool === 'ellipse') {
      found.push({
        index: m.index,
        el: {
          ...base,
          tool: 'ellipse',
          cx: num(attrs.cx),
          cy: num(attrs.cy),
          rx: num(attrs.rx),
          ry: num(attrs.ry),
        },
      })
    }
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.el)
}

/* ---------- 橡皮擦命中 ---------- */

function distToSeg(
  x: number,
  y: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number
): number {
  return perpDist([x, y], [x1, y1], [x2, y2])
}

/** 橡皮擦命中判断：(x, y) 半径 r 内是否触及元素 */
export function hitTest(el: WbElement, x: number, y: number, r: number): boolean {
  const rr = r + el.strokeWidth / 2
  switch (el.tool) {
    case 'pen':
      return el.points.some((p) => Math.hypot(p[0] - x, p[1] - y) <= rr)
    case 'line':
    case 'arrow':
      return distToSeg(x, y, el.x1, el.y1, el.x2, el.y2) <= rr
    case 'rect':
      return x >= el.x - rr && x <= el.x + el.w + rr && y >= el.y - rr && y <= el.y + el.h + rr
    case 'ellipse': {
      const dx = (x - el.cx) / (el.rx + rr || 1)
      const dy = (y - el.cy) / (el.ry + rr || 1)
      return dx * dx + dy * dy <= 1
    }
    case 'text': {
      const w = el.text.length * el.fontSize * 0.6
      return x >= el.x - rr && x <= el.x + w + rr && y >= el.y - el.fontSize - rr && y <= el.y + rr
    }
  }
}

/* ---------- 笔记内容中的白板附件引用 ---------- */

/**
 * 从笔记内容提取 `![...](attachments/*.svg)` 引用（去重保序）。
 * 附件目录不进笔记树也无法列目录，白板文件发现完全依赖内容中的引用。
 */
export function findSvgRefs(content: string): string[] {
  const re = /!\[[^\]]*\]\((attachments\/[^()\s]+\.svg)\)/g
  const seen = new Set<string>()
  const refs: string[] = []
  let m: RegExpExecArray | null
  while ((m = re.exec(content)) !== null) {
    if (!seen.has(m[1])) {
      seen.add(m[1])
      refs.push(m[1])
    }
  }
  return refs
}

/* ---------- UTF-8 安全 base64 ---------- */

/** SVG 文本（可能含中文）→ base64，经 UTF-8 编码避免 btoa 的 latin1 限制 */
export function svgToBase64(svg: string): string {
  const bytes = new TextEncoder().encode(svg)
  let binary = ''
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  }
  return btoa(binary)
}

/** base64 → SVG 文本（与 svgToBase64 互逆） */
export function base64ToSvg(b64: string): string {
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return new TextDecoder().decode(bytes)
}
