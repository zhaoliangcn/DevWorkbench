import { useEffect, useRef, useCallback, useState } from 'react'
import * as d3 from 'd3'
import { useStore } from '../../../store/knowledgeStore'
import { parseHeadings } from '../utils/mindmap'
import { Maximize2, Minimize2, Image, FileCode } from 'lucide-react'

interface TreeNode {
  id: string
  label: string
  level: number
  children: TreeNode[]
}

const LEVEL_COLORS = [
  '#6366f1',
  '#8b5cf6',
  '#a855f7',
  '#d946ef',
  '#ec4899',
  '#f43f5e',
]

type D3Node = d3.HierarchyPointNode<TreeNode>

function collapse(d: D3Node) {
  if (d.children) {
    ;(d as unknown as Record<string, unknown>)._children = d.children
    d.children = undefined
  }
}

function expand(d: D3Node) {
  const hidden = (d as unknown as Record<string, unknown>)._children as D3Node[] | undefined
  if (hidden) {
    d.children = hidden
    ;(d as unknown as Record<string, unknown>)._children = undefined
  }
}

function hasHiddenChildren(d: D3Node): boolean {
  return !!(d as unknown as Record<string, unknown>)._children
}

function toggleNode(d: D3Node) {
  if (d.children) {
    collapse(d)
  } else if (hasHiddenChildren(d)) {
    expand(d)
  }
}

function renderToSvg(
  svgElement: SVGSVGElement,
  container: HTMLDivElement,
  headingTree: ReturnType<typeof parseHeadings>
) {
  const svg = d3.select(svgElement)
  svg.selectAll('*').remove()

  if (!headingTree) return

  const width = container.clientWidth
  const height = container.clientHeight

  const root = d3.hierarchy<TreeNode>(headingTree as unknown as TreeNode)

  const treeLayout = d3.tree<TreeNode>()
    .size([height - 60, width - 160])
    .nodeSize([40, 120])

  treeLayout(root)

  const g = svg.append('g')

  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 3])
    .on('zoom', (event) => {
      g.attr('transform', event.transform.toString())
    })

  ;(svg as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(zoom)

  const descendants = root.descendants()
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  for (const d of descendants) {
    const x = d.x ?? 0
    const y = d.y ?? 0
    if (x < minX) minX = x
    if (x > maxX) maxX = x
    if (y < minY) minY = y
    if (y > maxY) maxY = y
  }

  const treeWidth = maxY - minY
  const treeHeight = maxX - minX

  const offsetX = (width - treeWidth) / 2 - minY
  const offsetY = (height - treeHeight) / 2 - minX

  ;(svg as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(
    zoom.transform,
    d3.zoomIdentity.translate(offsetX, offsetY)
  )

  const diagonal = (s: D3Node, d: D3Node) => {
    const sx = s.y
    const sy = s.x
    const dx = d.y
    const dy = d.x
    return `M${sx},${sy}
      C${(sx + dx) / 2},${sy}
       ${(sx + dx) / 2},${dy}
       ${dx},${dy}`
  }

  function update() {
    treeLayout(root)

    g.selectAll<SVGPathElement, d3.HierarchyPointLink<TreeNode>>('path')
      .data(root.links())
      .join('path')
      .attr('d', (l) => diagonal(l.source as D3Node, l.target as D3Node))
      .attr('fill', 'none')
      .attr('stroke', 'var(--border-color)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.7)

    const nodeG = g
      .selectAll<SVGGElement, D3Node>('g.node')
      .data(root.descendants() as D3Node[], (d) => d.data.id)
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d) => `translate(${d.y},${d.x})`)
      .attr('cursor', 'pointer')
      .on('click', (_event, d) => {
        toggleNode(d)
        update()
      })

    nodeG.each(function (d) {
      const sel = d3.select(this)
      sel.selectAll('*').remove()

      const color = LEVEL_COLORS[Math.min(d.data.level - 1, LEVEL_COLORS.length - 1)]
      const hasKids = !!(d.children || hasHiddenChildren(d))
      const text = d.data.label.length > 15 ? d.data.label.slice(0, 15) + '...' : d.data.label

      const textEl = sel
        .append('text')
        .text(text)
        .attr('dy', '0.35em')
        .attr('text-anchor', 'start')
        .attr('font-size', '12px')
        .attr('font-family', 'var(--font-sans)')
        .attr('fill', 'var(--text-primary)')
        .attr('x', 8)

      const bbox = (textEl.node() as SVGTextElement)?.getBBox()
      const tw = bbox ? bbox.width + 20 : 80
      const th = 28

      sel
        .insert('rect', 'text')
        .attr('x', 0)
        .attr('y', -th / 2)
        .attr('width', tw)
        .attr('height', th)
        .attr('rx', 6)
        .attr('ry', 6)
        .attr('fill', color + '20')
        .attr('stroke', color)
        .attr('stroke-width', 1.5)

      if (hasKids) {
        sel
          .append('circle')
          .attr('cx', tw + 8)
          .attr('cy', 0)
          .attr('r', 6)
          .attr('fill', color + '30')
          .attr('stroke', color)
          .attr('stroke-width', 1)

        sel
          .append('text')
          .attr('x', tw + 8)
          .attr('y', 0)
          .attr('dy', '0.35em')
          .attr('text-anchor', 'middle')
          .attr('font-size', '10px')
          .attr('fill', color)
          .text(d.children ? '\u2212' : '+')
      }
    })
  }

  update()
}

function exportAsSvg(svgElement: SVGSVGElement) {
  const clone = svgElement.cloneNode(true) as SVGSVGElement
  const bbox = svgElement.getBBox()
  clone.setAttribute('viewBox', `${bbox.x - 20} ${bbox.y - 20} ${bbox.width + 40} ${bbox.height + 40}`)
  clone.setAttribute('width', String(bbox.width + 40))
  clone.setAttribute('height', String(bbox.height + 40))

  const serializer = new XMLSerializer()
  const svgString = serializer.serializeToString(clone)
  const blob = new Blob([svgString], { type: 'image/svg+xml' })
  downloadBlob(blob, 'mindmap.svg')
}

function exportAsPng(svgElement: SVGSVGElement) {
  const clone = svgElement.cloneNode(true) as SVGSVGElement
  const bbox = svgElement.getBBox()
  const w = bbox.width + 40
  const h = bbox.height + 40
  clone.setAttribute('viewBox', `${bbox.x - 20} ${bbox.y - 20} ${w} ${h}`)
  clone.setAttribute('width', String(w * 2))
  clone.setAttribute('height', String(h * 2))

  const serializer = new XMLSerializer()
  const svgString = serializer.serializeToString(clone)

  const canvas = document.createElement('canvas')
  canvas.width = w * 2
  canvas.height = h * 2
  const ctx = canvas.getContext('2d')!

  const img = new window.Image()
  const svgBlob = new Blob([svgString], { type: 'image/svg+xml' })
  const url = URL.createObjectURL(svgBlob)

  img.onload = () => {
    ctx.fillStyle = '#1e1e2e'
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0)
    URL.revokeObjectURL(url)
    canvas.toBlob((blob) => {
      if (blob) downloadBlob(blob, 'mindmap.png')
    }, 'image/png')
  }

  img.src = url
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export default function MindMapView() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const fullscreenSvgRef = useRef<SVGSVGElement>(null)
  const fullscreenContainerRef = useRef<HTMLDivElement>(null)
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const activeNote = activeNoteId ? notes[activeNoteId] : null
  const headingTree = activeNote ? parseHeadings(activeNote.content) : null

  const doRender = useCallback(() => {
    if (!activeNote) return
    const tree = parseHeadings(activeNote.content)
    if (isFullscreen && fullscreenSvgRef.current && fullscreenContainerRef.current) {
      renderToSvg(fullscreenSvgRef.current, fullscreenContainerRef.current, tree)
    } else if (svgRef.current && containerRef.current) {
      renderToSvg(svgRef.current, containerRef.current, tree)
    }
  }, [activeNote, isFullscreen])

  useEffect(() => {
    doRender()
  }, [doRender])

  useEffect(() => {
    const handleResize = () => doRender()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [doRender])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false)
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isFullscreen])

  const handleExportSvg = () => {
    const el = isFullscreen ? fullscreenSvgRef.current : svgRef.current
    if (el) exportAsSvg(el)
  }

  const handleExportPng = () => {
    const el = isFullscreen ? fullscreenSvgRef.current : svgRef.current
    if (el) exportAsPng(el)
  }

  if (!activeNote) {
    return (
      <div className="panel-empty">
        <p>请先选择一个笔记</p>
      </div>
    )
  }

  if (!headingTree) {
    return (
      <div className="panel-empty">
        <p>当前笔记没有标题结构</p>
        <p className="panel-hint">使用 # 标题语法来构建思维导图</p>
      </div>
    )
  }

  return (
    <>
      <div ref={containerRef} className="mindmap-container">
        <div className="mindmap-toolbar">
          <span className="mindmap-title">{activeNote.title}</span>
          <div className="mindmap-toolbar-actions">
            <button className="icon-btn-small" onClick={handleExportSvg} title="导出 SVG">
              <FileCode size={14} />
            </button>
            <button className="icon-btn-small" onClick={handleExportPng} title="导出 PNG">
              <Image size={14} />
            </button>
            <button
              className="icon-btn-small"
              onClick={() => setIsFullscreen(true)}
              title="全屏"
            >
              <Maximize2 size={14} />
            </button>
          </div>
        </div>
        <svg ref={svgRef} className="mindmap-svg" />
        <div className="graph-hint">点击节点折叠/展开 · 滚轮缩放 · 拖拽平移</div>
      </div>

      {isFullscreen && (
        <div className="mindmap-fullscreen-overlay">
          <div className="mindmap-fullscreen-toolbar">
            <span className="mindmap-title">{activeNote.title} — 思维导图</span>
            <div className="mindmap-toolbar-actions">
              <button className="icon-btn-small" onClick={handleExportSvg} title="导出 SVG">
                <FileCode size={14} />
              </button>
              <button className="icon-btn-small" onClick={handleExportPng} title="导出 PNG">
                <Image size={14} />
              </button>
              <button
                className="icon-btn-small"
                onClick={() => setIsFullscreen(false)}
                title="退出全屏"
              >
                <Minimize2 size={14} />
              </button>
            </div>
          </div>
          <div ref={fullscreenContainerRef} className="mindmap-fullscreen-body">
            <svg ref={fullscreenSvgRef} className="mindmap-svg" />
          </div>
          <div className="graph-hint">点击节点折叠/展开 · 滚轮缩放 · 拖拽平移 · Esc 退出全屏</div>
        </div>
      )}
    </>
  )
}
