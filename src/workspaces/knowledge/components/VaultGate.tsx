import { useState } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { FolderOpen, BookOpen, HardDrive } from 'lucide-react'
import { isFileSystemSupported } from '../utils/filesystem'

export default function VaultGate() {
  const openVault = useStore((s) => s.openVault)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleOpenVault = async () => {
    setLoading(true)
    setError(null)
    try {
      await openVault()
    } catch {
      setError('打开文件夹失败，请重试')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="vault-gate">
      <div className="vault-gate-card">
        <div className="vault-gate-icon">
          <BookOpen size={48} />
        </div>
        <h1 className="vault-gate-title">MyObsidian</h1>
        <p className="vault-gate-desc">
          Markdown 知识库管理工具，笔记以文件形式保存在本地文件夹中
        </p>

        <div className="vault-gate-actions">
          {isFileSystemSupported() ? (
            <>
              <button
                className="btn btn-primary vault-gate-btn"
                onClick={handleOpenVault}
                disabled={loading}
              >
                <FolderOpen size={18} />
                <span>{loading ? '正在打开...' : '选择 Vault 文件夹'}</span>
              </button>
              <p className="vault-gate-hint">
                选择一个本地文件夹作为知识库，所有笔记将保存为 .md 文件
              </p>
            </>
          ) : (
            <>
              <button
                className="btn btn-primary vault-gate-btn"
                onClick={() => useStore.setState({ vaultReady: true })}
              >
                <HardDrive size={18} />
                <span>使用浏览器存储</span>
              </button>
              <p className="vault-gate-hint">
                当前浏览器不支持本地文件系统，笔记将保存在浏览器本地存储中
              </p>
            </>
          )}

          {error && <p className="vault-gate-error">{error}</p>}
        </div>
      </div>
    </div>
  )
}
