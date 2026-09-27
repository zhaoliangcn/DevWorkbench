import { useCallback, useRef } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import type { RightPanelTab } from '../../../types'
import BacklinksPanel from '../panels/BacklinksPanel'
import SearchPanel from '../panels/SearchPanel'
import TagsPanel from '../panels/TagsPanel'
import OutlinePanel from '../panels/OutlinePanel'
import TrashPanel from '../panels/TrashPanel'
import GraphView from '../panels/GraphView'
import MindMapView from '../panels/MindMapView'
import BoardView from '../panels/BoardView'
import CalendarView from '../panels/CalendarView'
import ReviewPanel from '../panels/ReviewPanel'
import Whiteboard from '../panels/Whiteboard'
import AiPanel from '../panels/AiPanel'
import { Link2, Search, Tag, GitGraph, Sparkles, GitFork, List, Trash2, SquareKanban, CalendarDays, Brain, PenTool } from 'lucide-react'

const MIN_WIDTH = 200
const MAX_WIDTH = 800
const DEFAULT_WIDTH = 300

const tabs: { id: RightPanelTab; label: string; icon: React.ReactNode }[] = [
  { id: 'backlinks', label: '链接', icon: <Link2 size={14} /> },
  { id: 'search', label: '搜索', icon: <Search size={14} /> },
  { id: 'tags', label: '标签', icon: <Tag size={14} /> },
  { id: 'outline', label: '大纲', icon: <List size={14} /> },
  { id: 'graph', label: '图谱', icon: <GitGraph size={14} /> },
  { id: 'mindmap', label: '导图', icon: <GitFork size={14} /> },
  { id: 'board', label: '看板', icon: <SquareKanban size={14} /> },
  { id: 'calendar', label: '日历', icon: <CalendarDays size={14} /> },
  { id: 'review', label: '复习', icon: <Brain size={14} /> },
  { id: 'whiteboard', label: '白板', icon: <PenTool size={14} /> },
  { id: 'ai', label: 'AI', icon: <Sparkles size={14} /> },
  { id: 'trash', label: '回收站', icon: <Trash2 size={14} /> },
]

export default function RightPanel() {
  const rightPanelTab = useStore((s) => s.rightPanelTab)
  const setRightPanelTab = useStore((s) => s.setRightPanelTab)
  const rightPanelWidth = useStore((s) => s.rightPanelWidth)
  const setRightPanelWidth = useStore((s) => s.setRightPanelWidth)
  const activeNoteId = useStore((s) => s.activeNoteId)

  const isResizing = useRef(false)
  const startX = useRef(0)
  const startWidth = useRef(0)

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    isResizing.current = true
    startX.current = e.clientX
    startWidth.current = rightPanelWidth

    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing.current) return
      const delta = startX.current - e.clientX
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, startWidth.current + delta))
      setRightPanelWidth(newWidth)
    }

    const handleMouseUp = () => {
      isResizing.current = false
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }

    document.addEventListener('mousemove', handleMouseMove)
    document.addEventListener('mouseup', handleMouseUp)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }, [rightPanelWidth, setRightPanelWidth])

  const handleDoubleClick = useCallback(() => {
    setRightPanelWidth(DEFAULT_WIDTH)
  }, [setRightPanelWidth])

  return (
    <div className="right-panel-container" style={{ width: rightPanelWidth, minWidth: rightPanelWidth }}>
      <div className="resize-handle" onMouseDown={handleMouseDown} onDoubleClick={handleDoubleClick} />
      <div className="right-panel">
        <div className="right-panel-tabs">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              className={`panel-tab ${rightPanelTab === tab.id ? 'active' : ''}`}
              onClick={() => setRightPanelTab(tab.id)}
              title={tab.label}
            >
              {tab.icon}
              <span>{tab.label}</span>
            </button>
          ))}
        </div>
        <div className="right-panel-content">
          {rightPanelTab === 'backlinks' && <BacklinksPanel />}
          {rightPanelTab === 'search' && <SearchPanel />}
          {rightPanelTab === 'tags' && <TagsPanel />}
          {rightPanelTab === 'outline' && <OutlinePanel />}
          {rightPanelTab === 'graph' && <GraphView />}
          {rightPanelTab === 'mindmap' && <MindMapView />}
          {rightPanelTab === 'board' && <BoardView />}
          {rightPanelTab === 'calendar' && <CalendarView />}
          {rightPanelTab === 'review' && <ReviewPanel />}
          {rightPanelTab === 'whiteboard' && <Whiteboard key={activeNoteId ?? 'none'} />}
          {rightPanelTab === 'ai' && <AiPanel />}
          {rightPanelTab === 'trash' && <TrashPanel />}
        </div>
      </div>
    </div>
  )
}
