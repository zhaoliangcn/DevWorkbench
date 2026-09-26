import { useMemo, useState } from 'react'
import { FilePlus2, X } from 'lucide-react'
import { useCrossStore, type Carry, type CarrySource } from '../../../store/crossStore'
import { useStore } from '../../../store/knowledgeStore'

const SOURCE_LABEL: Record<CarrySource, string> = {
  toolbox: '工具箱',
  assistant: 'AI 助手',
  knowledge: '知识库',
  capture: '捕获中心',
}

const FENCE_LANG: Partial<Record<Carry['kind'], string>> = {
  json: 'json',
  'http-response': 'http',
  'ssh-log': 'bash',
  'db-result': 'sql',
}

/** 落地笔记正文：来源引言行 + 内容（结构化类型包代码围栏）+ 可选标签 */
function buildContent(carry: Carry, withTag: boolean): string {
  const lines: string[] = []
  lines.push(`> 来源：DevWorkbench ${SOURCE_LABEL[carry.source]} · ${new Date(carry.createdAt).toLocaleString()}`)
  lines.push('')
  if (carry.kind === 'text') {
    lines.push(carry.content)
  } else {
    lines.push('```' + (FENCE_LANG[carry.kind] ?? ''))
    lines.push(carry.content)
    lines.push('```')
  }
  if (withTag) {
    lines.push('', `#工具/${carry.kind}`)
  }
  return lines.join('\n')
}

function CarryLandingInner({ carry }: { carry: Carry }) {
  const setCarry = useCrossStore((s) => s.setCarry)
  const pushLink = useCrossStore((s) => s.pushLink)
  const folders = useStore((s) => s.folders)
  const importNote = useStore((s) => s.importNote)
  const setActiveNote = useStore((s) => s.setActiveNote)

  const [title, setTitle] = useState(carry.title)
  const [folderPath, setFolderPath] = useState('')
  const [withTag, setWithTag] = useState(true)

  const preview = useMemo(() => buildContent(carry, withTag), [carry, withTag])

  const close = () => setCarry(null)

  const confirm = () => {
    const id = importNote(title.trim() || carry.title, preview, folderPath || undefined)
    if (id) setActiveNote(id)
    pushLink(carry.source, 'knowledge')
    setCarry(null)
  }

  return (
    <div className="carry-landing-overlay" onClick={close}>
      <div className="carry-landing-panel" onClick={(e) => e.stopPropagation()}>
        <div className="carry-landing-header">
          <FilePlus2 size={16} />
          <h3>落地为笔记</h3>
          <span className="carry-landing-meta">
            来自 {SOURCE_LABEL[carry.source]} · {carry.kind}
          </span>
          <button className="carry-landing-close" onClick={close} title="放弃本次携带物">
            <X size={15} />
          </button>
        </div>

        <div className="carry-landing-row">
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="笔记标题"
          />
          <select value={folderPath} onChange={(e) => setFolderPath(e.target.value)}>
            <option value="">根目录</option>
            {folders.map((f) => (
              <option key={f.id} value={f.path}>
                {f.path}
              </option>
            ))}
          </select>
        </div>

        <label className="carry-landing-tag-row">
          <input
            type="checkbox"
            checked={withTag}
            onChange={(e) => setWithTag(e.target.checked)}
          />
          <span>追加标签 #工具/{carry.kind}</span>
        </label>

        <pre className="carry-landing-preview">{preview}</pre>

        <div className="carry-landing-footer">
          <button className="carry-landing-btn" onClick={close}>
            取消
          </button>
          <button className="carry-landing-btn primary" onClick={confirm}>
            存为笔记
          </button>
        </div>
      </div>
    </div>
  )
}

// 知识库落地浮层：crossStore 中存在携带物时弹出，确认/取消后清槽。
// 以 carry.id 作为 key，确保每次新携带物都重置表单状态。
export function CarryLanding() {
  const carry = useCrossStore((s) => s.carry)
  if (!carry) return null
  return <CarryLandingInner key={carry.id} carry={carry} />
}
