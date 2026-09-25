import { useState } from 'react'
import { electronAPI } from '../utils/electron'
import { MIRRORS } from '../../../shared/data/mirrors'
import type { MirrorCategory } from '../../../shared/data/mirrors'

interface MirrorStatus {
  [url: string]: {
    available: boolean
    statusCode: number | null
    error?: string
    lastChecked: number
  }
}

export function MirrorTool() {
  const [selectedCategory, setSelectedCategory] = useState<string>(MIRRORS[0].id)
  const [statusMap, setStatusMap] = useState<MirrorStatus>({})
  const [checking, setChecking] = useState(false)

  const currentCategory: MirrorCategory | undefined = MIRRORS.find((c) => c.id === selectedCategory)

  const checkAllMirrors = async () => {
    if (!currentCategory) return
    setChecking(true)

    const newStatusMap: MirrorStatus = { ...statusMap }

    for (const mirror of currentCategory.mirrors) {
      try {
        const result = await electronAPI.checkMirror(mirror.url)
        newStatusMap[mirror.url] = {
          available: result.available,
          statusCode: result.statusCode,
          error: result.error,
          lastChecked: Date.now(),
        }
      } catch {
        newStatusMap[mirror.url] = {
          available: false,
          statusCode: null,
          error: '验证失败',
          lastChecked: Date.now(),
        }
      }
    }

    setStatusMap(newStatusMap)
    setChecking(false)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
  }

  const getStatusIcon = (url: string) => {
    const status = statusMap[url]
    if (!status) return '⚪'
    if (status.available) return '🟢'
    return '🔴'
  }

  const getStatusText = (url: string) => {
    const status = statusMap[url]
    if (!status) return '未验证'
    if (status.available) return `可用 (${status.statusCode})`
    return status.error || '不可用'
  }

  return (
    <div className="tool-container">
      <div className="tool-header">
        <h3>镜像地址</h3>
        <div className="tool-actions">
          <button onClick={checkAllMirrors} disabled={checking} className="btn-secondary">
            {checking ? '验证中...' : '验证全部'}
          </button>
        </div>
      </div>
      <div className="tool-body">
        <div className="tool-section">
          <h4>分类选择</h4>
          <div className="mirror-category-selector">
            {MIRRORS.map((cat) => (
              <button
                key={cat.id}
                className={`mirror-category-btn ${selectedCategory === cat.id ? 'active' : ''}`}
                onClick={() => setSelectedCategory(cat.id)}
              >
                <span className="category-icon">{cat.icon}</span>
                <span className="category-name">{cat.name}</span>
              </button>
            ))}
          </div>
        </div>

        {currentCategory && (
          <>
            <div className="tool-section">
              <h4>配置说明</h4>
              <div className="mirror-config-info">
                <p><strong>配置文件：</strong><code>{currentCategory.configFile}</code></p>
                <p><strong>使用方式：</strong><code>{currentCategory.usage}</code></p>
              </div>
            </div>

            <div className="tool-section">
              <h4>镜像列表 ({currentCategory.mirrors.length} 个)</h4>
              <div className="mirror-list">
                {currentCategory.mirrors.map((mirror) => (
                  <div key={mirror.id} className="mirror-item">
                    <div className="mirror-header">
                      <span className="mirror-status">{getStatusIcon(mirror.url)}</span>
                      <span className="mirror-name">{mirror.name}</span>
                      <span className="mirror-status-text">{getStatusText(mirror.url)}</span>
                    </div>
                    <div className="mirror-url">
                      <code>{mirror.url}</code>
                      <button
                        onClick={() => copyToClipboard(mirror.url)}
                        className="btn-secondary copy-btn"
                      >
                        复制
                      </button>
                    </div>
                    <p className="mirror-desc">{mirror.description}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
