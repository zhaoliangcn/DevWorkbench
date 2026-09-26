import { useState, useEffect } from 'react'
import { useAppStore } from '../../store/appStore'
import { useAssistantStore, DEFAULT_ASSISTANT_POLICY } from '../../store/assistantStore'
import { electronAPI } from '../toolbox/utils/electron'
import { assistantAPI } from '../assistant/utils/electron'
import { Plus, Trash2, Power, PowerOff } from 'lucide-react'
import '../assistant/assistant.css'

// 统一设置页：来自 dev-tool-box SettingsModule，状态以 appStore 为单一数据源
export function SettingsWorkspace() {
  const theme = useAppStore((s) => s.theme)
  const setTheme = useAppStore((s) => s.setTheme)
  const fontSize = useAppStore((s) => s.fontSize)
  const setFontSize = useAppStore((s) => s.setFontSize)
  const cursorBlink = useAppStore((s) => s.cursorBlink)
  const setCursorBlink = useAppStore((s) => s.setCursorBlink)
  const [version, setVersion] = useState('')

  // AI 助手：模型配置（assistantStore 为单一数据源，保存时经 IPC 热替换）
  const models = useAssistantStore((s) => s.models)
  const activeModel = useAssistantStore((s) => s.activeModel)
  const addModel = useAssistantStore((s) => s.addModel)
  const updateModel = useAssistantStore((s) => s.updateModel)
  const removeModel = useAssistantStore((s) => s.removeModel)
  const assistantStatus = useAssistantStore((s) => s.status)
  const assistantError = useAssistantStore((s) => s.error)
  const [saving, setSaving] = useState(false)

  // 三段式权限清单（切片 E）：本地文本编辑态，保存时解析为清单
  const [needsApprovalText, setNeedsApprovalText] = useState(
    useAssistantStore.getState().policy.needsApproval.join(', '),
  )
  const [disabledText, setDisabledText] = useState(
    useAssistantStore.getState().policy.disabled.join(', '),
  )
  const [policySaved, setPolicySaved] = useState(false)

  /** 逗号 / 中文逗号 / 空白分隔 → 去重清单 */
  const parseList = (text: string) =>
    [...new Set(text.split(/[,，\s]+/).map((t) => t.trim()).filter(Boolean))]

  const currentPolicy = () => ({
    needsApproval: parseList(needsApprovalText),
    disabled: parseList(disabledText),
  })

  const handleSavePolicy = () => {
    useAssistantStore.getState().setPolicy(currentPolicy())
    setPolicySaved(true)
    setTimeout(() => setPolicySaved(false), 2000)
  }

  const handleResetPolicy = () => {
    setNeedsApprovalText(DEFAULT_ASSISTANT_POLICY.needsApproval.join(', '))
    setDisabledText(DEFAULT_ASSISTANT_POLICY.disabled.join(', '))
    useAssistantStore.getState().setPolicy(DEFAULT_ASSISTANT_POLICY)
  }

  const applyAssistantConfig = async (modelsToSave?: AssistantModelConfig[]) => {
    const finalModels = modelsToSave ?? models
    const active = finalModels.find((m) => m.name === activeModel) ?? finalModels[0]
    if (!active) return
    setSaving(true)
    try {
      const policy = currentPolicy()
      useAssistantStore.getState().setPolicy(policy)
      const res = await assistantAPI.start({
        models: finalModels,
        schedulerEnabled: true,
        approvalEnabled: useAssistantStore.getState().approvalEnabled,
        policy,
      })
      useAssistantStore.getState().setStatus(res.status)
      useAssistantStore.getState().setError(res.error ?? '')
      if (!res.success) useAssistantStore.getState().setError(res.error ?? '启动失败')
    } catch (e) {
      useAssistantStore.getState().setError(e instanceof Error ? e.message : String(e))
    } finally {
      setSaving(false)
    }
  }

  const handleSaveModel = () => {
    void applyAssistantConfig()
  }

  const handleAddModel = () => {
    const name = `model-${models.length + 1}`
    addModel({
      name,
      provider: 'openai',
      apiUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      temperature: 0.7,
      maxOutputTokens: 2048,
    })
  }

  const handleStopAssistant = async () => {
    await assistantAPI.stop()
    useAssistantStore.getState().setStatus(null)
  }

  useEffect(() => {
    ;(async () => {
      try {
        setVersion(await electronAPI.getAppVersion())
      } catch {
        setVersion('1.0.0')
      }
    })()
  }, [])

  return (
    <div className="settings-page">
      <div className="settings-container">
        <h2>设置</h2>

        <div className="settings-section">
          <h4>外观</h4>
          <div className="setting-row">
            <label>主题</label>
            <select value={theme} onChange={(e) => setTheme(e.target.value as 'light' | 'dark')}>
              <option value="light">浅色</option>
              <option value="dark">深色</option>
            </select>
          </div>
          <div className="setting-row">
            <label>字体大小</label>
            <input
              type="number"
              value={fontSize}
              onChange={(e) => setFontSize(parseInt(e.target.value) || 16)}
              min="12"
              max="24"
            />
          </div>
        </div>

        <div className="settings-section">
          <h4>终端</h4>
          <div className="setting-row">
            <label>光标闪烁（SSH 终端）</label>
            <input
              type="checkbox"
              checked={cursorBlink}
              onChange={(e) => setCursorBlink(e.target.checked)}
            />
          </div>
        </div>

        <div className="settings-section">
          <h4>AI 助手</h4>
          <p className="settings-hint">
            模型配置用于顶栏「AI 助手」工作区（嵌入 dev-assistant-ts，workingDir 为知识库 Vault）。
            保存后立即生效（运行时热替换，无需重启应用）。
          </p>

          {models.map((m) => (
            <div key={m.name} className="assistant-model-card">
              <div className="assistant-model-head">
                <input
                  className="assistant-model-name"
                  value={m.name}
                  onChange={(e) => updateModel({ ...m, name: e.target.value })}
                  placeholder="名称"
                />
                <button
                  className="assistant-active-toggle"
                  onClick={() => useAssistantStore.getState().setActiveModel(m.name)}
                  title="设为活跃模型"
                >
                  {activeModel === m.name ? '✓ 活跃' : '设为活跃'}
                </button>
                <button className="icon-btn-small" onClick={() => removeModel(m.name)} title="删除">
                  <Trash2 size={13} />
                </button>
              </div>
              <div className="assistant-model-grid">
                <label>
                  Provider
                  <select
                    value={m.provider}
                    onChange={(e) =>
                      updateModel({
                        ...m,
                        provider: e.target.value as AssistantModelConfig['provider'],
                        apiUrl:
                          e.target.value === 'ollama'
                            ? 'http://localhost:11434/v1'
                            : e.target.value === 'openai'
                              ? 'https://api.openai.com/v1'
                              : m.apiUrl,
                      })
                    }
                  >
                    <option value="ollama">ollama</option>
                    <option value="openai">openai</option>
                    <option value="openai-compatible">openai-compatible</option>
                  </select>
                </label>
                <label>
                  模型
                  <input
                    value={m.model}
                    onChange={(e) => updateModel({ ...m, model: e.target.value })}
                    placeholder="qwen2.5:7b / gpt-4o-mini"
                  />
                </label>
                <label className="assistant-model-grid-wide">
                  API 端点
                  <input
                    value={m.apiUrl}
                    onChange={(e) => updateModel({ ...m, apiUrl: e.target.value })}
                    placeholder="http://localhost:11434/v1"
                  />
                </label>
                {m.provider !== 'ollama' && (
                  <label className="assistant-model-grid-wide">
                    API Key
                    <input
                      type="password"
                      value={m.apiKey}
                      onChange={(e) => updateModel({ ...m, apiKey: e.target.value })}
                      placeholder="sk-..."
                    />
                  </label>
                )}
                <label>
                  温度 ({m.temperature})
                  <input
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={m.temperature}
                    onChange={(e) => updateModel({ ...m, temperature: parseFloat(e.target.value) })}
                  />
                </label>
                <label>
                  最大 Token
                  <input
                    type="number"
                    value={m.maxOutputTokens}
                    min="256"
                    max="32768"
                    onChange={(e) => updateModel({ ...m, maxOutputTokens: parseInt(e.target.value) || 2048 })}
                  />
                </label>
              </div>
            </div>
          ))}

          <div className="assistant-model-actions">
            <button className="assistant-btn" onClick={handleAddModel}>
              <Plus size={13} /> 添加模型
            </button>
            <button className="assistant-btn primary" onClick={handleSaveModel} disabled={saving || models.length === 0}>
              {saving ? '保存中…' : '保存并重启助手'}
            </button>
            <button
              className="assistant-btn"
              onClick={handleStopAssistant}
              disabled={!assistantStatus?.running}
            >
              {assistantStatus?.running ? <PowerOff size={13} /> : <Power size={13} />} 停止助手
            </button>
          </div>

          <div className="assistant-policy-card">
            <h5>工具权限（三段式清单）</h5>
            <p className="settings-hint">
              强制审批：名单内工具每次执行前弹出审批确认；禁用：启动时不注册（LLM 不可见，含任意命令执行面）；
              其余低危工具自动放行。以逗号分隔，「保存并重启助手」后生效。
            </p>
            <label>
              强制审批（needs-approval）
              <input
                value={needsApprovalText}
                onChange={(e) => setNeedsApprovalText(e.target.value)}
                placeholder="write_file, edit_file"
                spellCheck={false}
              />
            </label>
            <label>
              禁用（disabled）
              <input
                value={disabledText}
                onChange={(e) => setDisabledText(e.target.value)}
                placeholder="exec_command, run_hook"
                spellCheck={false}
              />
            </label>
            <div className="assistant-model-actions">
              <button className="assistant-btn primary" onClick={handleSavePolicy}>
                {policySaved ? '已保存' : '保存权限清单'}
              </button>
              <button className="assistant-btn" onClick={handleResetPolicy}>
                恢复默认
              </button>
            </div>
          </div>

          {assistantStatus?.running && (
            <p className="settings-hint">
              运行中 · 会话 {assistantStatus.sessionId ?? '-'} · 活跃模型{' '}
              {assistantStatus.activeProvider ?? '-'} · {assistantStatus.url ?? '(仅 IPC 模式)'}
            </p>
          )}
          {assistantError && <p className="assistant-error">{assistantError}</p>}
        </div>

        <div className="settings-section">
          <h4>关于</h4>
          <div className="about-info">
            <p><strong>DevWorkbench 开发者工作台</strong></p>
            <p>版本: {version || '1.0.0'}</p>
            <p>一站式开发者工作台：知识库 + 开发工具箱</p>
          </div>
        </div>

        <span className="badge">AI 服务 / API Server 设置将在后续版本加入</span>
      </div>
    </div>
  )
}
