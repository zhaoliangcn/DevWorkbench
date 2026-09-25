import { useState, useEffect } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { FolderOpen, Check } from 'lucide-react'

export default function SettingsPanel() {
  const [vaultPath, setVaultPath] = useState<string | null>(null)
  const [vaultName, setVaultName] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const openVault = useStore((s) => s.openVault)

  useEffect(() => {
    ;(async () => {
      const api = window.electronAPI
      if (api) {
        const path = await api.vault.getPath()
        const name = await api.vault.getName()
        setVaultPath(path)
        setVaultName(name)
      }
    })()
  }, [])

  const handleChangeVault = async () => {
    if (loading) return

    setLoading(true)
    setMessage(null)

    try {
      const api = window.electronAPI
      console.log('切换知识库，api 存在:', !!api)
      if (api) {
        console.log('调用 api.vault.select()')
        const result = await api.vault.select()
        console.log('vault.select 结果:', result)
        if (result) {
          setVaultPath(result.path)
          setVaultName(result.name)
          useStore.setState({ vaultName: result.name })
          console.log('开始加载知识库...')
          await useStore.getState().loadVaultFromDisk()
          console.log('知识库加载完成')
          setMessage('知识库已切换成功')
        } else {
          setMessage('未选择文件夹')
        }
      } else {
        console.log('浏览器模式，调用 openVault')
        await openVault()
        const name = useStore.getState().vaultName
        if (name) {
          setVaultName(name)
          setVaultPath(null)
          await useStore.getState().loadVaultFromDisk()
          setMessage('知识库已切换成功')
        }
      }
    } catch (err) {
      console.error('切换知识库失败:', err)
      setMessage('切换失败: ' + (err instanceof Error ? err.message : String(err)))
    } finally {
      setLoading(false)
    }
  }

  const handleRestoreVault = async () => {
    if (loading) return

    setLoading(true)
    setMessage(null)

    try {
      const api = window.electronAPI
      if (api) {
        const name = await api.vault.getName()
        if (name) {
          useStore.setState({ vaultName: name })
          await useStore.getState().loadVaultFromDisk()
          setMessage('知识库已恢复')
        } else {
          setMessage('未找到已保存的知识库')
        }
      } else {
        setMessage('浏览器模式下不支持此功能')
      }
    } catch (err) {
      console.error('恢复知识库失败:', err)
      setMessage('恢复失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="settings-panel">
      <div className="settings-header">
        <h3>设置</h3>
      </div>

      <div className="settings-section">
        <h4>知识库存储位置</h4>

        <div className="settings-vault-info">
          <div className="vault-info-row">
            <span className="vault-info-label">当前路径：</span>
            <span className="vault-info-value" title={vaultPath || '未设置'}>
              {vaultPath || '未设置'}
            </span>
          </div>
          <div className="vault-info-row">
            <span className="vault-info-label">知识库名称：</span>
            <span className="vault-info-value">
              {vaultName || '未设置'}
            </span>
          </div>
          {vaultName && (
            <div className="vault-info-row">
              <span className="vault-status-badge vault-status-open">
                <Check size={12} /> 已连接
              </span>
            </div>
          )}
        </div>

        <div className="settings-actions">
          <button
            className="settings-btn primary"
            onClick={handleChangeVault}
            disabled={loading}
          >
            <FolderOpen size={14} />
            {loading ? '切换中...' : '切换知识库'}
          </button>
          <button
            className="settings-btn secondary"
            onClick={handleRestoreVault}
            disabled={loading}
          >
            {loading ? '恢复中...' : '恢复上次知识库'}
          </button>
        </div>

        {message && (
          <div className={`settings-message ${message.includes('成功') || message.includes('恢复') ? 'success' : 'error'}`}>
            {message}
          </div>
        )}
      </div>
    </div>
  )
}
