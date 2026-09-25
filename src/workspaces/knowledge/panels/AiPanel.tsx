import { useState, useRef } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { callAi } from '../utils/ai'
import type { AiAction, AiProvider } from '../../../types'
import {
  Play,
  Square,
  Copy,
  Check,
  Loader2,
  Settings2,
  ChevronDown,
  Wand2,
  FileText,
  ListChecks,
  FileOutput,
  AlignLeft,
} from 'lucide-react'

const ACTIONS: { id: AiAction; label: string; icon: React.ReactNode; desc: string }[] = [
  { id: 'continue', label: '续写', icon: <Play size={14} />, desc: '从末尾自然续写内容' },
  { id: 'expand', label: '扩写', icon: <Wand2 size={14} />, desc: '丰富细节和论证' },
  { id: 'grammar', label: '语法检查', icon: <ListChecks size={14} />, desc: '修正语法和错别字' },
  { id: 'summarize', label: '摘要', icon: <FileOutput size={14} />, desc: '提取核心要点' },
  { id: 'format', label: '格式优化', icon: <AlignLeft size={14} />, desc: '规范排版和格式' },
]

export default function AiPanel() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const updateNoteContent = useStore((s) => s.updateNoteContent)
  const aiConfig = useStore((s) => s.aiConfig)
  const updateAiConfig = useStore((s) => s.updateAiConfig)

  const [result, setResult] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [showSettings, setShowSettings] = useState(false)
  const [copied, setCopied] = useState(false)
  const [applied, setApplied] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  const activeNote = activeNoteId ? notes[activeNoteId] : null

  const handleAction = async (action: AiAction) => {
    if (!activeNote) return
    setLoading(true)
    setError('')
    setResult('')
    setApplied(false)

    abortRef.current = new AbortController()

    try {
      const content = activeNote.content
      const response = await callAi(aiConfig, action, content)
      setResult(response)
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        setError('已取消')
      } else {
        setError(err instanceof Error ? err.message : '请求失败')
      }
    } finally {
      setLoading(false)
      abortRef.current = null
    }
  }

  const handleStop = () => {
    abortRef.current?.abort()
  }

  const handleApply = (mode: 'replace' | 'append') => {
    if (!activeNoteId || !result) return

    if (mode === 'replace') {
      updateNoteContent(activeNoteId, result)
    } else {
      updateNoteContent(activeNoteId, activeNote!.content + '\n\n' + result)
    }
    setApplied(true)
    setTimeout(() => setApplied(false), 2000)
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(result)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleProviderChange = (provider: AiProvider) => {
    if (provider === 'ollama') {
      updateAiConfig({
        provider: 'ollama',
        endpoint: 'http://localhost:11434/v1',
        model: 'qwen2.5:7b',
        apiKey: '',
      })
    } else {
      updateAiConfig({
        provider: 'openai',
        endpoint: 'https://api.openai.com/v1',
        model: 'gpt-4o-mini',
        apiKey: '',
      })
    }
  }

  if (!activeNote) {
    return (
      <div className="panel-empty">
        <p>请先选择一个笔记</p>
      </div>
    )
  }

  return (
    <div className="ai-panel">
      <div className="ai-actions">
        {ACTIONS.map((act) => (
          <button
            key={act.id}
            className="ai-action-btn"
            onClick={() => handleAction(act.id)}
            disabled={loading}
            title={act.desc}
          >
            {loading ? <Loader2 size={14} className="spin" /> : act.icon}
            <span>{act.label}</span>
          </button>
        ))}
      </div>

      {loading && (
        <button className="ai-stop-btn" onClick={handleStop}>
          <Square size={12} /> 停止生成
        </button>
      )}

      {error && <div className="ai-error">{error}</div>}

      {result && (
        <div className="ai-result">
          <div className="ai-result-header">
            <span className="ai-result-title">生成结果</span>
            <div className="ai-result-actions">
              <button className="icon-btn-small" onClick={handleCopy} title="复制">
                {copied ? <Check size={12} /> : <Copy size={12} />}
              </button>
              <button
                className="ai-apply-btn"
                onClick={() => handleApply('replace')}
              >
                {applied ? <Check size={12} /> : <FileText size={12} />}
                {applied ? '已应用' : '替换原文'}
              </button>
              <button
                className="ai-apply-btn"
                onClick={() => handleApply('append')}
              >
                <Play size={12} /> 追加到末尾
              </button>
            </div>
          </div>
          <div className="ai-result-content markdown-body">
            {result}
          </div>
        </div>
      )}

      <div className="ai-settings">
        <button
          className="ai-settings-toggle"
          onClick={() => setShowSettings(!showSettings)}
        >
          <Settings2 size={14} />
          <span>模型设置</span>
          <ChevronDown
            size={14}
            style={{ transform: showSettings ? 'rotate(180deg)' : '' }}
          />
        </button>

        {showSettings && (
          <div className="ai-settings-body">
            <div className="ai-setting-group">
              <label>服务提供商</label>
              <div className="provider-switch">
                <button
                  className={aiConfig.provider === 'ollama' ? 'active' : ''}
                  onClick={() => handleProviderChange('ollama')}
                >
                  Ollama
                </button>
                <button
                  className={aiConfig.provider === 'openai' ? 'active' : ''}
                  onClick={() => handleProviderChange('openai')}
                >
                  OpenAI
                </button>
              </div>
            </div>

            <div className="ai-setting-group">
              <label>API 端点</label>
              <input
                type="text"
                value={aiConfig.endpoint}
                onChange={(e) => updateAiConfig({ endpoint: e.target.value })}
                placeholder="http://localhost:11434/v1"
              />
            </div>

            <div className="ai-setting-group">
              <label>模型名称</label>
              <input
                type="text"
                value={aiConfig.model}
                onChange={(e) => updateAiConfig({ model: e.target.value })}
                placeholder="qwen2.5:7b"
              />
            </div>

            {aiConfig.provider === 'openai' && (
              <div className="ai-setting-group">
                <label>API Key</label>
                <input
                  type="password"
                  value={aiConfig.apiKey}
                  onChange={(e) => updateAiConfig({ apiKey: e.target.value })}
                  placeholder="sk-..."
                />
              </div>
            )}

            <div className="ai-setting-row">
              <div className="ai-setting-group">
                <label>温度 ({aiConfig.temperature})</label>
                <input
                  type="range"
                  min="0"
                  max="2"
                  step="0.1"
                  value={aiConfig.temperature}
                  onChange={(e) =>
                    updateAiConfig({ temperature: parseFloat(e.target.value) })
                  }
                />
              </div>
              <div className="ai-setting-group">
                <label>最大 Token</label>
                <input
                  type="number"
                  value={aiConfig.maxTokens}
                  onChange={(e) =>
                    updateAiConfig({ maxTokens: parseInt(e.target.value) || 2048 })
                  }
                  min={256}
                  max={32768}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
