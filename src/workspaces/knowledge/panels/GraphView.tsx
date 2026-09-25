import { useEffect, useRef, useCallback } from 'react'
import * as d3 from 'd3'
import { useStore } from '../../../store/knowledgeStore'
import type { Link } from '../../../types'

interface GraphNode extends d3.SimulationNodeDatum {
  id: string
  title: string
  group: number
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string
  target: string
}

export default function GraphView() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const notes = useStore((s) => s.notes)
  const getAllLinks = useStore((s) => s.getAllLinks)
  const setActiveNote = useStore((s) => s.setActiveNote)
  const activeNoteId = useStore((s) => s.activeNoteId)

  const renderGraph = useCallback(() => {
    const svg = d3.select(svgRef.current)
    const container = containerRef.current
    if (!container) return

    svg.selectAll('*').remove()

    const width = container.clientWidth
    const height = container.clientHeight

    const noteList = Object.values(notes)
    if (noteList.length === 0) return

    const links: Link[] = getAllLinks()

    const nodeMap = new Map<string, GraphNode>()
    const nodes: GraphNode[] = noteList.map((n) => {
      const node: GraphNode = {
        id: n.id,
        title: n.title,
        group: n.tags.length > 0 ? 1 : 0,
      }
      nodeMap.set(n.id, node)
      return node
    })

    const graphLinks: GraphLink[] = links
      .filter((l) => nodeMap.has(l.source) && nodeMap.has(l.target))
      .map((l) => ({
        source: l.source,
        target: l.target,
      }))

    const g = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString())
      })

    ;(svg as unknown as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(zoom)

    const simulation = d3
      .forceSimulation<GraphNode>(nodes)
      .force(
        'link',
        d3
          .forceLink<GraphNode, GraphLink>(graphLinks)
          .id((d) => d.id)
          .distance(100)
      )
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(30))

    const link = g
      .append('g')
      .selectAll<SVGLineElement, GraphLink>('line')
      .data(graphLinks)
      .join('line')
      .attr('stroke', 'var(--graph-link)')
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.6)

    const node = g
      .append('g')
      .selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3
          .drag<SVGGElement, GraphNode>()
          .on('start', (event, d) => {
            if (!event.active) simulation.alphaTarget(0.3).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (event, d) => {
            d.fx = event.x
            d.fy = event.y
          })
          .on('end', (event, d) => {
            if (!event.active) simulation.alphaTarget(0)
            d.fx = null
            d.fy = null
          })
      )
      .on('click', (_event, d) => {
        setActiveNote(d.id)
      })

    node
      .append('circle')
      .attr('r', (d) => (d.id === activeNoteId ? 8 : 6))
      .attr('fill', (d) =>
        d.id === activeNoteId
          ? 'var(--graph-active)'
          : 'var(--graph-node)'
      )
      .attr('stroke', 'var(--graph-node-stroke)')
      .attr('stroke-width', 1.5)

    node
      .append('text')
      .text((d) => d.title.length > 8 ? d.title.slice(0, 8) + '...' : d.title)
      .attr('x', 10)
      .attr('y', 4)
      .attr('font-size', '10px')
      .attr('fill', 'var(--text-secondary)')
      .attr('pointer-events', 'none')

    simulation.on('tick', () => {
      link
        .attr('x1', (d) => (d.source as unknown as GraphNode).x!)
        .attr('y1', (d) => (d.source as unknown as GraphNode).y!)
        .attr('x2', (d) => (d.target as unknown as GraphNode).x!)
        .attr('y2', (d) => (d.target as unknown as GraphNode).y!)

      node.attr('transform', (d) => `translate(${d.x},${d.y})`)
    })

    return () => {
      simulation.stop()
    }
  }, [notes, getAllLinks, setActiveNote, activeNoteId])

  useEffect(() => {
    const cleanup = renderGraph()
    return () => {
      cleanup?.()
    }
  }, [renderGraph])

  useEffect(() => {
    const handleResize = () => {
      renderGraph()
    }
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [renderGraph])

  return (
    <div ref={containerRef} className="graph-container">
      <svg ref={svgRef} className="graph-svg" />
      <div className="graph-hint">拖拽节点移动 · 滚轮缩放 · 点击节点打开笔记</div>
    </div>
  )
}
