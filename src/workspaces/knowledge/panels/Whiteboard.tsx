import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Pencil,
  Minus,
  ArrowUpRight,
  Square,
  Circle,
  Type,
  Eraser,
  Undo2,
  Redo2,
  Save,
  X,
  Plus,
} from 'lucide-react'
import { useStore } from '../../../store/knowledgeStore'
import { readBinaryFile, writeBinaryFile } from '../utils/filesystem'
import { mimeFromPath } from '../utils/image'
import {
  hitTest,
  findSvgRefs,
  penPath,
  newId,
  svgToElements,
  elementsToSvg,
  svgToBase64,
  base64ToSvg,
  WB_W,
  WB_H,
} from '../utils/whiteboard'
import type { WbElement, WbTool, WbLine, WbArrow, WbRect, WbEllipse } from '../utils/whiteboard'

const COLORS = ['#94a3b8', '#e5484d', '#f76b15', '#30a46c', '#0090ff', '#8e4ec6']
const DEFAULT_COLOR = COLORS[4]
const WIDTHS = [2, 4, 8]
const ERASER_R = 12

interface TextDraft {
  x: number
  y: number
  sx: number
  sy: number
  value: string
}

function elementNodes(el: WbElement) {
  const common = {
    stroke: el.stroke,
    strokeWidth: el.strokeWidth,
    fill: 'none',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
  switch (el.tool) {
    case 'pen':
      return <path d={penPath(el.points)} {...common} />
    case 'line':
      return <line x1={el.x1} y1={el.y1} x2={el.x2} y2={el.y2} {...common} />
    case 'arrow':
      return (
        <line
          x1={el.x1}
          y1={el.y1}
          x2={el.x2}
          y2={el.y2}
          {...common}
          markerEnd="url(#wb-arrow-head)"
        />
      )
    case 'rect':
      return <rect x={el.x} y={el.y} width={el.w} height={el.h} rx={4} {...common} />
    case 'ellipse':
      return <ellipse cx={el.cx} cy={el.cy} rx={el.rx} ry={el.ry} {...common} />
    case 'text':
      return (
        <text x={el.x} y={el.y} fontSize={el.fontSize} fill={el.stroke}>
          {el.text}
        </text>
      )
  }
}

const TOOL_ICONS: Record<string, React.ReactNode> = {
  pen: <Pencil size={14} />,
  line: <Minus size={14} />,
  arrow: <ArrowUpRight size={14} />,
  rect: <Square size={14} />,
  ellipse: <Circle size={14} />,
  text: <Type size={14} />,
  eraser: <Eraser size={14} />,
}

export default function Whiteboard() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const updateNoteContent = useStore((s) => s.updateNoteContent)

  const activeNote = activeNoteId ? notes[activeNoteId] : null

  const [elements, setElements] = useState<WbElement[]>([])
  const [currentPath, setCurrentPath] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [tool, setTool] = useState<WbTool>('pen')
  const [color, setColor] = useState(DEFAULT_COLOR)
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[0])
  const [draft, setDraft] = useState<WbElement | null>(null)
  const [textInput, setTextInput] = useState<TextDraft | null>(null)
  const [thumbs, setThumbs] = useState<Record<string, string>>({})

  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const drawRef = useRef<{ start: [number, number]; points: [number, number][] } | null>(null)
  const erasingRef = useRef(false)
  const undoRef = useRef<WbElement[][]>([])
  const redoRef = useRef<WbElement[][]>([])
  const [undoDepth, setUndoDepth] = useState(0)
  const [redoDepth, setRedoDepth] = useState(0)

  const refs = useMemo(() => (activeNote ? findSvgRefs(activeNote.content) : []), [activeNote])

  // 加载缩略图（附件目录不可列目录，依赖内容引用）
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const map: Record<string, string> = {}
      for (const ref of refs) {
        const b64 = await readBinaryFile(ref)
        if (b64) map[ref] = `data:${mimeFromPath(ref)};base64,${b64}`
      }
      if (!cancelled) setThumbs(map)
    })()
    return () => {
      cancelled = true
    }
  }, [refs])

  const toCanvas = useCallback((e: { clientX: number; clientY: number }): [number, number] => {
    const svg = svgRef.current
    if (!svg) return [0, 0]
    const rect = svg.getBoundingClientRect()
    const scale = Math.min(rect.width / WB_W, rect.height / WB_H)
    const offX = (rect.width - WB_W * scale) / 2
    const offY = (rect.height - WB_H * scale) / 2
    return [(e.clientX - rect.left - offX) / scale, (e.clientY - rect.top - offY) / scale]
  }, [])

  const toScreen = useCallback((x: number, y: number): [number, number] => {
    const svg = svgRef.current
    const container = containerRef.current
    if (!svg || !container) return [0, 0]
    const rect = svg.getBoundingClientRect()
    const crect = container.getBoundingClientRect()
    const scale = Math.min(rect.width / WB_W, rect.height / WB_H)
    const offX = (rect.width - WB_W * scale) / 2
    const offY = (rect.height - WB_H * scale) / 2
    return [
      rect.left - crect.left + offX + x * scale,
      rect.top - crect.top + offY + y * scale,
    ]
  }, [])

  const pushUndo = useCallback(
    (snapshot: WbElement[]) => {
      undoRef.current.push(snapshot)
      redoRef.current = []
      setUndoDepth(undoRef.current.length)
      setRedoDepth(0)
    },
    []
  )

  const commit = useCallback(
    (el: WbElement | null) => {
      if (!el) return
      pushUndo(elements)
      setElements([...elements, { ...el, id: newId() }])
      setDirty(true)
    },
    [elements, pushUndo]
  )

  const eraseAt = useCallback(
    (pt: [number, number]) => {
      const remaining = elements.filter((el) => !hitTest(el, pt[0], pt[1], ERASER_R))
      if (remaining.length === elements.length) return
      pushUndo(elements)
      setElements(remaining)
      setDirty(true)
    },
    [elements, pushUndo]
  )

  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      if (textInput) return
      const pt = toCanvas(e)
      if (tool === 'text') {
        const [sx, sy] = toScreen(pt[0], pt[1])
        setTextInput({ x: pt[0], y: pt[1], sx, sy, value: '' })
        return
      }
      if (tool === 'eraser') {
        erasingRef.current = true
        eraseAt(pt)
        return
      }
      e.currentTarget.setPointerCapture?.(e.pointerId)
      drawRef.current = { start: pt, points: [pt] }
      if (tool === 'pen') setDraft({ id: 'draft', tool: 'pen', stroke: color, strokeWidth, points: [pt] })
    },
    [textInput, tool, color, strokeWidth, toCanvas, toScreen, eraseAt]
  )

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (erasingRef.current) {
        eraseAt(toCanvas(e))
        return
      }
      const st = drawRef.current
      if (!st) return
      const pt = toCanvas(e)
      if (tool === 'pen') {
        st.points.push(pt)
        setDraft({ id: 'draft', tool: 'pen', stroke: color, strokeWidth, points: [...st.points] })
        return
      }
      const [sx, sy] = st.start
      let next: WbElement | null = null
      if (tool === 'line' || tool === 'arrow') {
        next = {
          id: 'draft',
          tool,
          stroke: color,
          strokeWidth,
          x1: sx,
          y1: sy,
          x2: pt[0],
          y2: pt[1],
        } as WbLine | WbArrow
      } else if (tool === 'rect') {
        next = {
          id: 'draft',
          tool: 'rect',
          stroke: color,
          strokeWidth,
          x: Math.min(sx, pt[0]),
          y: Math.min(sy, pt[1]),
          w: Math.abs(pt[0] - sx),
          h: Math.abs(pt[1] - sy),
        } as WbRect
      } else if (tool === 'ellipse') {
        next = {
          id: 'draft',
          tool: 'ellipse',
          stroke: color,
          strokeWidth,
          cx: (sx + pt[0]) / 2,
          cy: (sy + pt[1]) / 2,
          rx: Math.abs(pt[0] - sx) / 2,
          ry: Math.abs(pt[1] - sy) / 2,
        } as WbEllipse
      }
      setDraft(next)
    },
    [tool, color, strokeWidth, toCanvas, eraseAt]
  )

  const handlePointerUp = useCallback(() => {
    erasingRef.current = false
    const st = drawRef.current
    drawRef.current = null
    if (!st) return
    if (tool === 'pen') {
      if (st.points.length >= 2) commit(draft)
    } else {
      commit(draft)
    }
    setDraft(null)
  }, [tool, draft, commit])

  const commitText = useCallback(() => {
    if (textInput && textInput.value.trim()) {
      pushUndo(elements)
      setElements([
        ...elements,
        {
          id: newId(),
          tool: 'text',
          x: textInput.x,
          y: textInput.y,
          text: textInput.value,
          fontSize: 18,
          stroke: color,
          strokeWidth: 2,
        },
      ])
      setDirty(true)
    }
    setTextInput(null)
  }, [textInput, elements, color, pushUndo])

  const handleUndo = useCallback(() => {
    const prev = undoRef.current.pop()
    if (!prev) return
    redoRef.current.push(elements)
    setElements(prev)
    setUndoDepth(undoRef.current.length)
    setRedoDepth(redoRef.current.length)
    setDirty(true)
  }, [elements])

  const handleRedo = useCallback(() => {
    const next = redoRef.current.pop()
    if (!next) return
    undoRef.current.push(elements)
    setElements(next)
    setUndoDepth(undoRef.current.length)
    setRedoDepth(redoRef.current.length)
    setDirty(true)
  }, [elements])

  const handleSave = useCallback(async () => {
    if (!activeNoteId || !activeNote || elements.length === 0) return
    const path = currentPath ?? `attachments/wb-${Date.now().toString(36)}.svg`
    try {
      await writeBinaryFile(path, svgToBase64(elementsToSvg(elements)))
      if (!currentPath) {
        const ref = `![白板](${path})`
        updateNoteContent(activeNoteId, activeNote.content.replace(/\s*$/, '') + '\n\n' + ref + '\n')
        setCurrentPath(path)
      }
      setDirty(false)
    } catch (err) {
      console.error('白板保存失败', err)
    }
  }, [activeNoteId, activeNote, elements, currentPath, updateNoteContent])

  const openRef = useCallback(async (relPath: string) => {
    const b64 = await readBinaryFile(relPath)
    if (!b64) return
    setElements(svgToElements(base64ToSvg(b64)))
    setCurrentPath(relPath)
    undoRef.current = []
    redoRef.current = []
    setUndoDepth(0)
    setRedoDepth(0)
    setDirty(false)
    setIsFullscreen(true)
  }, [])

  const startNew = useCallback(() => {
    setElements([])
    setCurrentPath(null)
    undoRef.current = []
    redoRef.current = []
    setUndoDepth(0)
    setRedoDepth(0)
    setDirty(false)
    setIsFullscreen(true)
  }, [])

  // Esc：优先取消文字输入，否则退出全屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isFullscreen) return
      if (textInput) {
        setTextInput(null)
        return
      }
      setIsFullscreen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isFullscreen, textInput])

  if (!activeNote) {
    return (
      <div className="panel-empty">
        <p>请先选择一个笔记</p>
        <p className="panel-hint">白板以 SVG 附件形式挂载到当前笔记</p>
      </div>
    )
  }

  const hasSession = elements.length > 0

  return (
    <>
      <div className="whiteboard-container">
        <div className="whiteboard-toolbar">
          <span className="whiteboard-title">白板</span>
          <div className="whiteboard-toolbar-actions">
            {hasSession && (
              <button className="icon-btn-small" onClick={() => setIsFullscreen(true)} title="继续编辑当前白板">
                <Pencil size={14} />
              </button>
            )}
            <button className="icon-btn-small" onClick={startNew} title="新建白板">
              <Plus size={14} />
            </button>
          </div>
        </div>
        {refs.length === 0 && !hasSession ? (
          <div className="panel-empty">
            <p>当前笔记还没有白板</p>
            <p className="panel-hint">点击 + 新建，手绘图会保存为 SVG 附件并插入笔记</p>
          </div>
        ) : (
          <div className="whiteboard-list">
            {hasSession && (
              <button className="whiteboard-thumb current" onClick={() => setIsFullscreen(true)}>
                <span className="whiteboard-thumb-label">
                  当前草稿{dirty ? ' ·未保存' : ''}
                </span>
                <svg viewBox={`0 0 ${WB_W} ${WB_H}`} className="whiteboard-thumb-svg">
                  {elements.map((el) => (
                    <g key={el.id}>{elementNodes(el)}</g>
                  ))}
                </svg>
              </button>
            )}
            {refs.map((ref) => (
              <button key={ref} className="whiteboard-thumb" onClick={() => openRef(ref)}>
                <span className="whiteboard-thumb-label">{ref.split('/').pop()}</span>
                {thumbs[ref] ? (
                  <img src={thumbs[ref]} alt={ref} className="whiteboard-thumb-img" />
                ) : (
                  <div className="whiteboard-thumb-loading">加载中…</div>
                )}
              </button>
            ))}
          </div>
        )}
        <div className="graph-hint">手绘图保存为 SVG 附件 · 可在预览中直接嵌入</div>
      </div>

      {isFullscreen && (
        <div className="wb-overlay">
          <div className="wb-overlay-toolbar">
            <span className="whiteboard-title">
              {activeNote.title} — 白板{dirty ? ' ·未保存' : ''}
            </span>
            <div className="wb-tools">
              {(['pen', 'line', 'arrow', 'rect', 'ellipse', 'text', 'eraser'] as WbTool[]).map(
                (t) => (
                  <button
                    key={t}
                    className={`icon-btn-small ${tool === t ? 'active' : ''}`}
                    onClick={() => setTool(t)}
                    title={
                      { pen: '画笔', line: '直线', arrow: '箭头', rect: '矩形', ellipse: '椭圆', text: '文字', eraser: '橡皮擦' }[t]
                    }
                  >
                    {TOOL_ICONS[t]}
                  </button>
                )
              )}
            </div>
            <div className="wb-swatches">
              {COLORS.map((c) => (
                <button
                  key={c}
                  className={`wb-swatch ${color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  title={c}
                />
              ))}
            </div>
            <div className="wb-widths">
              {WIDTHS.map((w) => (
                <button
                  key={w}
                  className={`wb-width ${strokeWidth === w ? 'active' : ''}`}
                  onClick={() => setStrokeWidth(w)}
                  title={`线宽 ${w}`}
                >
                  <span style={{ width: 4 + w * 2, height: 4 + w * 2 }} />
                </button>
              ))}
            </div>
            <div className="wb-actions">
              <button
                className="icon-btn-small"
                onClick={handleUndo}
                disabled={undoDepth === 0}
                title="撤销"
              >
                <Undo2 size={14} />
              </button>
              <button
                className="icon-btn-small"
                onClick={handleRedo}
                disabled={redoDepth === 0}
                title="重做"
              >
                <Redo2 size={14} />
              </button>
              <button className="icon-btn-small" onClick={handleSave} title="保存到笔记">
                <Save size={14} />
              </button>
              <button
                className="icon-btn-small"
                onClick={() => setIsFullscreen(false)}
                title="退出（Esc）"
              >
                <X size={14} />
              </button>
            </div>
          </div>
          <div ref={containerRef} className="wb-canvas">
            <svg
              ref={svgRef}
              className="wb-svg"
              viewBox={`0 0 ${WB_W} ${WB_H}`}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerLeave={handlePointerUp}
              style={{ cursor: tool === 'eraser' ? 'cell' : tool === 'text' ? 'text' : 'crosshair' }}
            >
              <defs>
                <marker
                  id="wb-arrow-head"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="7"
                  markerHeight="7"
                  orient="auto-start-reverse"
                >
                  <path d="M0,0 L10,5 L0,10 z" fill="context-stroke" />
                </marker>
              </defs>
              {elements.map((el) => (
                <g key={el.id}>{elementNodes(el)}</g>
              ))}
              {draft && <g key="draft">{elementNodes(draft)}</g>}
            </svg>
            {textInput && (
              <input
                className="wb-text-input"
                style={{ left: textInput.sx, top: textInput.sy - 22 }}
                autoFocus
                value={textInput.value}
                placeholder="输入文字，回车确认"
                onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitText()
                  if (e.key === 'Escape') setTextInput(null)
                }}
                onBlur={commitText}
              />
            )}
          </div>
          <div className="graph-hint">画笔/直线/箭头/矩形/椭圆/文字 · 橡皮擦擦除 · 磁盘图标保存 · Esc 退出</div>
        </div>
      )}
    </>
  )
}
