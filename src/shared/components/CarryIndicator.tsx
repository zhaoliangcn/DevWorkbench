import { ArrowRight, X } from 'lucide-react'
import { useCrossStore, type CarryKind } from '../../store/crossStore'
import { useAppStore } from '../../store/appStore'

const KIND_ICON: Record<CarryKind, string> = {
  text: '📝',
  json: '{}',
  url: '🔗',
  timestamp: '🕐',
  'http-response': '🌐',
  'ssh-log': '💻',
  'db-result': '🗄️',
  image: '🖼️',
  'note-ref': '📄',
}

// 跨工作区携带物徽章（切片 C）：carry 非空时右下角常驻提示，
// 点击跳知识库落地（CarryLanding 自动弹出），× 放弃。
export function CarryIndicator() {
  const carry = useCrossStore((s) => s.carry)
  const setCarry = useCrossStore((s) => s.setCarry)
  const setActiveWorkspace = useAppStore((s) => s.setActiveWorkspace)

  if (!carry) return null

  return (
    <div className="carry-indicator">
      <span className="carry-indicator-icon">{KIND_ICON[carry.kind] ?? '📦'}</span>
      <span className="carry-indicator-title" title={carry.content.slice(0, 200)}>
        {carry.title}
      </span>
      <button
        className="carry-indicator-go"
        onClick={() => setActiveWorkspace('knowledge')}
        title="去知识库落地"
      >
        <ArrowRight size={13} />
      </button>
      <button
        className="carry-indicator-drop"
        onClick={() => setCarry(null)}
        title="放弃本次携带物"
      >
        <X size={13} />
      </button>
    </div>
  )
}
