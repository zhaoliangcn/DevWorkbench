import { useMemo, useState } from 'react'
import { Copy, Eye, EyeOff, FileDown, FilePlus, X } from 'lucide-react'
import { electronAPI } from '../utils/electron'
import {
  diffEnvFiles,
  generateComposeEnv,
  generateEnvExample,
  maskValue,
  parseEnvFile,
} from './pure/envfile'
import type { EnvFileParsed } from './pure/envfile'

interface LoadedFile {
  path: string
  name: string
  parsed: EnvFileParsed
}

type SnippetKind = 'compose' | 'example'

export function EnvManagerTool() {
  const [files, setFiles] = useState<LoadedFile[]>([])
  const [error, setError] = useState('')
  const [mask, setMask] = useState(true)
  const [snippet, setSnippet] = useState<{ kind: SnippetKind; text: string } | null>(null)

  const openFiles = async () => {
    setError('')
    const picked = await electronAPI.envPickFiles()
    if (!picked.success || picked.files.length === 0) return
    const loaded: LoadedFile[] = []
    for (const f of picked.files) {
      // 已加载的同路径文件跳过（去重）
      if (files.some((x) => x.path === f.path) || loaded.some((x) => x.path === f.path)) continue
      const r = await electronAPI.envReadFile(f.path)
      if (r.success) {
        loaded.push({ path: f.path, name: f.name, parsed: parseEnvFile(r.raw) })
      } else {
        setError(`${f.name}: ${r.error ?? '读取失败'}`)
      }
    }
    if (loaded.length) setFiles((prev) => [...prev, ...loaded])
  }

  const removeFile = (path: string) => {
    setFiles((prev) => prev.filter((f) => f.path !== path))
    setSnippet(null)
  }

  const diff = useMemo(
    () => (files.length ? diffEnvFiles(files.map((f) => ({ name: f.name, parsed: f.parsed }))) : null),
    [files]
  )

  const makeSnippet = (kind: SnippetKind) => {
    if (kind === 'compose') {
      // 多文件时取第一个（对话框多选常为单文件场景；多文件场景提示用户）
      const target = files[0]
      if (!target) return
      setSnippet({ kind, text: generateComposeEnv(target.parsed) })
    } else {
      if (!diff) return
      setSnippet({ kind, text: generateEnvExample(diff) })
    }
  }

  const copySnippet = async () => {
    if (!snippet) return
    await navigator.clipboard.writeText(snippet.text)
  }

  return (
    <div className="module-container">
      <div className="module-header">
        <h3>.env 管理器</h3>
      </div>
      <div className="module-body">
        <div className="envman-toolbar">
          <button onClick={openFiles}>
            <FilePlus size={13} /> 打开 .env 文件…
          </button>
          <button
            onClick={() => setMask((m) => !m)}
            disabled={!files.length}
            title={mask ? '显示明文' : '掩码显示'}
          >
            {mask ? <Eye size={13} /> : <EyeOff size={13} />} {mask ? '掩码' : '明文'}
          </button>
          <span className="envman-meta">
            {files.length
              ? `${files.length} 个文件 · 共 ${diff?.rows.length ?? 0} 键 · 缺失 ${diff?.missingCounts.reduce((a, b) => a + b, 0) ?? 0} · 不一致 ${diff?.inconsistentCount ?? 0}`
              : '未加载文件'}
          </span>
        </div>

        {error && <p className="envman-error">{error}</p>}

        {diff && (
          <div
            className="envman-table"
            style={{ ['--envman-cols' as string]: `minmax(140px, 1.2fr) repeat(${files.length}, minmax(100px, 1fr))` }}
          >
            <div className="envman-row envman-head">
              <span>键</span>
              {files.map((f, i) => (
                <span key={f.path} className="envman-filehead" title={f.path}>
                  {f.name}
                  {diff.missingCounts[i] > 0 && <em className="envman-missbadge">缺 {diff.missingCounts[i]}</em>}
                  <button onClick={() => removeFile(f.path)} title="移除">
                    <X size={10} />
                  </button>
                </span>
              ))}
            </div>
            {diff.rows.map((row) => (
              <div
                key={row.key}
                className={`envman-row ${row.inconsistent ? 'warn' : ''}`}
                title={row.comment}
              >
                <span className="envman-key">{row.key}</span>
                {row.values.map((v, i) => (
                  <span key={files[i].path} className={v === null ? 'envman-missing' : 'envman-value'}>
                    {v === null ? '缺失' : mask ? maskValue(v) : v || '""'}
                  </span>
                ))}
              </div>
            ))}
          </div>
        )}

        {!files.length && (
          <p className="tool-hint">打开两个及以上 .env 文件可对比键缺失与值不一致；单文件可生成 compose 环境段与 .env.example 模板。</p>
        )}

        <div className="envman-generators">
          <button onClick={() => makeSnippet('compose')} disabled={!files.length}>
            <FileDown size={13} /> 生成 compose 环境段
          </button>
          <button onClick={() => makeSnippet('example')} disabled={!files.length}>
            <FileDown size={13} /> 生成 .env.example
          </button>
        </div>

        {snippet && (
          <div className="envman-snippet">
            <div className="envman-snippet-head">
              <span>{snippet.kind === 'compose' ? 'docker-compose environment 片段' : '.env.example 模板'}</span>
              <span className="envman-snippet-actions">
                <button onClick={copySnippet} title="复制">
                  <Copy size={12} />
                </button>
                <button onClick={() => setSnippet(null)} title="关闭">
                  <X size={12} />
                </button>
              </span>
            </div>
            <pre className="envman-snippet-body">{snippet.text}</pre>
          </div>
        )}
      </div>
    </div>
  )
}
