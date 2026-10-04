import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import DOMPurify from 'dompurify'
import { useStore } from '../../../store/knowledgeStore'
import { marked } from 'marked'
import type { EditorMode } from '../../../types'
import { Edit3, Eye, Columns, Bold, Italic, Link, Code, FileDown, FileText, Pin, PinOff } from 'lucide-react'
import { exportToDocx, exportToPdf } from '../utils/export'
import { parseWikiLink, escapeHtml } from '../utils/markdown'
import { extractHeadings, readingStats } from '../utils/outline'
import { arrayBufferToBase64, mimeFromPath } from '../utils/image'
import { writeBinaryFile, readBinaryFile } from '../utils/filesystem'

marked.setOptions({
  breaks: true,
  gfm: true,
})

/** 附件 dataURL 缓存：path → dataURL，跨笔记/跨渲染复用，避免重复读盘（FIFO 上限防无界增长） */
const IMAGE_CACHE_MAX = 100
const imageDataCache = new Map<string, string>()

function cacheImageData(path: string, dataUrl: string): void {
  if (imageDataCache.has(path)) imageDataCache.delete(path)
  imageDataCache.set(path, dataUrl)
  if (imageDataCache.size > IMAGE_CACHE_MAX) {
    const oldest = imageDataCache.keys().next().value
    if (oldest !== undefined) imageDataCache.delete(oldest)
  }
}

/** 大纲跳转事件（OutlinePanel → 预览区滚动） */
const OUTLINE_JUMP_EVENT = 'knowledge:outline-jump'

function renderMarkdown(content: string): string {
  let html = content

  // 别名（附录 E E.3.1）：显示 alias（缺省 target）；标题来自用户内容，必须转义
  html = html.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, raw: string) => {
      const { target, alias } = parseWikiLink(raw)
      if (!target) return _match
      const label = escapeHtml(alias || target)
      return `<a class="wiki-link" data-note-title="${escapeHtml(target)}" href="#">${label}</a>`
    }
  )

  let rawHtml = marked.parse(html) as string

  // 大纲锚点（附录 E E.3.5）：按文档序号给标题注入 id，与 extractHeadings 的 h-N 对应
  let headingIndex = 0
  rawHtml = rawHtml.replace(/<h([1-6])((?:\s[^>]*)?>)/g, (_m, lvl: string, rest: string) => {
    return `<h${lvl} id="h-${headingIndex++}"${rest}`
  })
  // 消毒（P0 修复）：marked 透传原始 HTML，笔记内容（可能来自他人共享）未经
  // 过滤不得进 DOM——过滤内联事件、script/iframe、javascript: 链接等向量
  return DOMPurify.sanitize(rawHtml, { ADD_ATTR: ['data-note-title'] })
}

/** wikilink 标题能否成为合法目标（含 [|] 的标题排除在补全候选之外） */
function isSuggestableTitle(title: string): boolean {
  return title.length > 0 && !/[[\]|]/.test(title)
}

export default function MarkdownEditor() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const updateNoteContent = useStore((s) => s.updateNoteContent)
  const updateNoteTitle = useStore((s) => s.updateNoteTitle)
  // 死链生长（附录 E E.3.1）：标题已存在则跳转，不存在则一键创建并打开
  const createNoteWithTitle = useStore((s) => s.createNoteWithTitle)
  const pinnedForAssistant = useStore((s) => s.pinnedForAssistant)
  const togglePinForAssistant = useStore((s) => s.togglePinForAssistant)

  const [mode, setMode] = useState<EditorMode>('edit')
  const [editingTitle, setEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  /** [[ 自动补全状态：raw 为 `[[` 后已输入文本，target/alias 按 `|` 切分 */
  const [wikiHint, setWikiHint] = useState<{
    raw: string
    alias: string | null
    activeIndex: number
    top: number
    left: number
  } | null>(null)

  const activeNote = activeNoteId ? notes[activeNoteId] : null

  /** 大纲数据（附录 E E.3.5）：状态栏标题数 + OutlinePanel 共用提取逻辑 */
  const headings = useMemo(
    () => (activeNote ? extractHeadings(activeNote.content) : []),
    [activeNote]
  )

  const wikiTitles = useMemo(
    () => Object.values(notes).map((n) => n.title).filter(isSuggestableTitle),
    [notes]
  )

  const wikiCandidates = useMemo(() => {
    if (!wikiHint) return []
    const q = wikiHint.raw.indexOf('|') === -1 ? wikiHint.raw.trim().toLowerCase() : wikiHint.raw.slice(0, wikiHint.raw.indexOf('|')).trim().toLowerCase()
    return wikiTitles
      .filter((t) => t.toLowerCase().includes(q) && t.toLowerCase() !== q)
      .slice(0, 7)
  }, [wikiHint, wikiTitles])

  useEffect(() => {
    if (editingTitle && titleInputRef.current) {
      titleInputRef.current.focus()
      titleInputRef.current.select()
    }
  }, [editingTitle])

  useEffect(() => {
    const el = previewRef.current
    if (!el) return

    const handleWikiClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement
      if (target.classList.contains('wiki-link')) {
        e.preventDefault()
        const noteTitle = target.getAttribute('data-note-title')
        if (noteTitle) {
          // 已存在则跳转；死链则创建（标题即骨架 `# title`）并打开
          createNoteWithTitle(noteTitle)
        }
      }
    }
    el.addEventListener('click', handleWikiClick)
    return () => {
      el.removeEventListener('click', handleWikiClick)
    }
  }, [activeNote?.content, createNoteWithTitle])

  /** 切换笔记后残留的光标定位失效，直接关闭补全（渲染期「prop 变化调整 state」，避免 effect） */
  const [lastNoteId, setLastNoteId] = useState(activeNoteId)
  if (lastNoteId !== activeNoteId) {
    setLastNoteId(activeNoteId)
    setWikiHint(null)
  }

  /** 大纲跳转（附录 E E.3.5）：OutlinePanel 发事件 → 预览区滚动到对应标题锚点 */
  useEffect(() => {
    const handler = (e: Event) => {
      const id = (e as CustomEvent<string>).detail
      if (!/^h-\d+$/.test(id)) return // 只认自注入锚点，防选择器注入
      previewRef.current?.querySelector(`[id="${id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.addEventListener(OUTLINE_JUMP_EVENT, handler)
    return () => window.removeEventListener(OUTLINE_JUMP_EVENT, handler)
  }, [])

  /** 附件图片代理（附录 E E.3.5）：预览区相对路径 → IPC 读盘 → dataURL（缓存命中跳过） */
  useEffect(() => {
    const el = previewRef.current
    if (!el) return
    for (const img of Array.from(el.querySelectorAll<HTMLImageElement>('img[src^="attachments/"]'))) {
      const relPath = img.getAttribute('src')
      if (!relPath) continue
      const cached = imageDataCache.get(relPath)
      if (cached) {
        img.src = cached
        continue
      }
      readBinaryFile(relPath)
        .then((base64) => {
          if (!base64) return
          const dataUrl = `data:${mimeFromPath(relPath)};base64,${base64}`
          cacheImageData(relPath, dataUrl)
          img.src = dataUrl
        })
        .catch(() => {
          // 附件缺失：保留原生裂图，不打断渲染
        })
    }
  }, [activeNote?.content, mode])

  /** 粘贴图片（附录 E E.3.5）：拦截剪贴板 → 写 attachments/ → 插入相对路径引用 */
  const handlePaste = useCallback(
    async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
      const textarea = textareaRef.current
      if (!textarea || !activeNoteId) return
      const imageItem = Array.from(e.clipboardData.items).find((i) => i.type.startsWith('image/'))
      if (!imageItem) return
      e.preventDefault()
      const file = imageItem.getAsFile()
      if (!file) return

      try {
        const base64 = arrayBufferToBase64(await file.arrayBuffer())
        const ext = imageItem.type === 'image/jpeg' ? 'jpg' : imageItem.type.split('/')[1] || 'png'
        const relPath = `attachments/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}.${ext}`
        await writeBinaryFile(relPath, base64)

        const pos = textarea.selectionStart
        const ref = `![${relPath.split('/').pop()}](${relPath})`
        const next = textarea.value.slice(0, pos) + ref + textarea.value.slice(pos)
        updateNoteContent(activeNoteId, next)

        requestAnimationFrame(() => {
          textarea.focus()
          const caret = pos + ref.length
          textarea.selectionStart = caret
          textarea.selectionEnd = caret
        })
      } catch {
        window.alert('保存附件失败：未打开 Vault 或写入出错')
      }
    },
    [activeNoteId, updateNoteContent]
  )

  /** 依据光标前缀决定是否弹出 [[ 补全；仅当 raw 变化时重置选中项 */
  const updateWikiHint = useCallback(() => {
    const textarea = textareaRef.current
    if (!textarea || !activeNoteId) {
      setWikiHint(null)
      return
    }
    const pos = textarea.selectionStart
    const before = textarea.value.slice(0, pos)
    const m = /\[\[([^\]\n]*)$/.exec(before)
    if (!m) {
      setWikiHint(null)
      return
    }
    const raw = m[1]
    const pipe = raw.indexOf('|')
    const alias = pipe === -1 ? null : raw.slice(pipe + 1)

    // 行列估算定位（附录 E E.3.1：textarea 无光标坐标 API，用行高×行号）
    const style = getComputedStyle(textarea)
    const lineHeight = parseFloat(style.lineHeight) || 22
    const charWidth = (parseFloat(style.fontSize) || 14) * 0.6
    const row = before.split('\n').length - 1
    const col = before.length - (before.lastIndexOf('\n') + 1)
    const top =
      (parseFloat(style.paddingTop) || 12) + (row + 1) * lineHeight - textarea.scrollTop + 2
    const left = (parseFloat(style.paddingLeft) || 12) + col * charWidth

    setWikiHint((prev) =>
      prev && prev.raw === raw ? prev : { raw, alias, activeIndex: 0, top, left }
    )
  }, [activeNoteId])

  /** 插入补全：替换 `[[...query` 为完整链接；`|` 后别名文本保留 */
  const insertWikiLink = useCallback(
    (target: string) => {
      const textarea = textareaRef.current
      if (!textarea || !activeNoteId || !wikiHint) return
      const pos = textarea.selectionStart
      const value = textarea.value
      const openIndex = pos - wikiHint.raw.length - 2
      const inserted = `[[${target}${wikiHint.alias !== null ? `|${wikiHint.alias}` : ''}]]`
      const next = value.slice(0, openIndex) + inserted + value.slice(pos)

      updateNoteContent(activeNoteId, next)
      setWikiHint(null)

      requestAnimationFrame(() => {
        textarea.focus()
        const caret = openIndex + inserted.length
        textarea.selectionStart = caret
        textarea.selectionEnd = caret
      })
    },
    [activeNoteId, wikiHint, updateNoteContent]
  )

  const insertFormatting = useCallback(
    (prefix: string, suffix: string) => {
      const textarea = textareaRef.current
      if (!textarea || !activeNoteId) return

      const start = textarea.selectionStart
      const end = textarea.selectionEnd
      const selected = textarea.value.substring(start, end)
      const newText =
        textarea.value.substring(0, start) +
        prefix +
        selected +
        suffix +
        textarea.value.substring(end)

      updateNoteContent(activeNoteId, newText)

      requestAnimationFrame(() => {
        textarea.focus()
        textarea.selectionStart = start + prefix.length
        textarea.selectionEnd = end + prefix.length
      })
    },
    [activeNoteId, updateNoteContent]
  )

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      // [[ 补全激活时的键盘导航（附录 E E.3.1）
      if (wikiHint && wikiCandidates.length > 0) {
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          setWikiHint((h) =>
            h ? { ...h, activeIndex: (h.activeIndex + 1) % wikiCandidates.length } : h
          )
          return
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault()
          setWikiHint((h) =>
            h
              ? { ...h, activeIndex: (h.activeIndex + wikiCandidates.length - 1) % wikiCandidates.length }
              : h
          )
          return
        }
        if (e.key === 'Enter' || e.key === 'Tab') {
          e.preventDefault()
          const fallbackTarget = wikiHint.raw.split('|')[0].trim()
          insertWikiLink(wikiCandidates[wikiHint.activeIndex] ?? fallbackTarget)
          return
        }
        if (e.key === 'Escape') {
          e.preventDefault()
          setWikiHint(null)
          return
        }
      }
      if (e.key === 'Tab') {
        e.preventDefault()
        insertFormatting('  ', '')
      }
    },
    [wikiHint, wikiCandidates, insertWikiLink, insertFormatting]
  )

  /** 光标移动/点击后重估补全；导航键已在 keydown 消费，避免重置选中项 */
  const handleKeyUp = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (['ArrowUp', 'ArrowDown', 'Enter', 'Escape'].includes(e.key)) return
      updateWikiHint()
    },
    [updateWikiHint]
  )

  const handleExportDocx = useCallback(async () => {
    if (!activeNote) return
    await exportToDocx(activeNote.title, activeNote.content)
  }, [activeNote])

  const handleExportPdf = useCallback(async () => {
    if (!activeNote) return
    await exportToPdf(activeNote.title, activeNote.content)
  }, [activeNote])

  if (!activeNote) {
    return (
      <div className="editor-empty">
        <div className="empty-state">
          <Edit3 size={48} strokeWidth={1} />
          <h2>没有打开的笔记</h2>
          <p>从左侧文件浏览器选择或创建一个笔记</p>
        </div>
      </div>
    )
  }

  return (
    <div className="markdown-editor">
      <div className="editor-header">
        <div className="editor-title-area">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              className="title-input"
              value={activeNote.title}
              onChange={(e) => updateNoteTitle(activeNote.id, e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingTitle(false)
              }}
            />
          ) : (
            <h1
              className="editor-title"
              onClick={() => setEditingTitle(true)}
              title="点击编辑标题"
            >
              {activeNote.title}
            </h1>
          )}
        </div>

        <div className="editor-toolbar">
          <div className="toolbar-group">
            <button
              className="icon-btn"
              onClick={() => insertFormatting('**', '**')}
              title="粗体"
            >
              <Bold size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => insertFormatting('*', '*')}
              title="斜体"
            >
              <Italic size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => insertFormatting('[', '](url)')}
              title="链接"
            >
              <Link size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={() => insertFormatting('`', '`')}
              title="代码"
            >
              <Code size={16} />
            </button>
          </div>

          <div className="toolbar-group mode-switcher">
            <button
              className={`icon-btn ${mode === 'edit' ? 'active' : ''}`}
              onClick={() => setMode('edit')}
              title="编辑模式"
            >
              <Edit3 size={16} />
            </button>
            <button
              className={`icon-btn ${mode === 'split' ? 'active' : ''}`}
              onClick={() => setMode('split')}
              title="分屏模式"
            >
              <Columns size={16} />
            </button>
            <button
              className={`icon-btn ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
              title="预览模式"
            >
              <Eye size={16} />
            </button>
          </div>

          <div className="toolbar-group export-group">
            <button
              className={`icon-btn ${activeNote && pinnedForAssistant.includes(activeNote.id) ? 'active' : ''}`}
              onClick={() => togglePinForAssistant(activeNote.id)}
              title={activeNote && pinnedForAssistant.includes(activeNote.id) ? '取消钉到助手' : '钉到助手（发送消息时作为上下文）'}
            >
              {activeNote && pinnedForAssistant.includes(activeNote.id) ? <PinOff size={16} /> : <Pin size={16} />}
            </button>
            <button
              className="icon-btn"
              onClick={handleExportDocx}
              title="导出为 DOCX"
            >
              <FileText size={16} />
            </button>
            <button
              className="icon-btn"
              onClick={handleExportPdf}
              title="导出为 PDF"
            >
              <FileDown size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className={`editor-content mode-${mode}`}>
        {(mode === 'edit' || mode === 'split') && (
          <div className="editor-pane edit-pane">
            <textarea
              ref={textareaRef}
              className="editor-textarea"
              value={activeNote.content}
              onChange={(e) => {
                updateNoteContent(activeNote.id, e.target.value)
                updateWikiHint()
              }}
              onKeyDown={handleKeyDown}
              onKeyUp={handleKeyUp}
              onPaste={handlePaste}
              onBlur={() => setWikiHint(null)}
              onClick={updateWikiHint}
              placeholder="开始书写..."
              spellCheck={false}
            />
            {wikiHint && wikiCandidates.length > 0 && (
              <div
                className="wiki-autocomplete"
                style={{ top: wikiHint.top, left: wikiHint.left }}
              >
                {wikiCandidates.map((t, i) => (
                  <button
                    key={t}
                    type="button"
                    className={`wiki-autocomplete-item${i === wikiHint.activeIndex ? ' active' : ''}`}
                    onMouseEnter={() => setWikiHint((h) => (h ? { ...h, activeIndex: i } : h))}
                    // mousedown 阻止 textarea 失焦，保证点击插入生效
                    onMouseDown={(e) => {
                      e.preventDefault()
                      insertWikiLink(t)
                    }}
                  >
                    {t}
                  </button>
                ))}
                <div className="wiki-autocomplete-hint">↑↓ 选择 · Enter 插入 · Esc 关闭 · 输入 | 添加别名</div>
              </div>
            )}
          </div>
        )}

        {(mode === 'preview' || mode === 'split') && (
          <div
            ref={previewRef}
            className="editor-pane preview-pane markdown-body"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(activeNote.content),
            }}
          />
        )}
      </div>

      <div className="editor-statusbar">
        <span>{readingStats(activeNote.content).chars} 字</span>
        <span>约 {readingStats(activeNote.content).minutes} 分钟</span>
        {headings.length > 0 && <span>{headings.length} 个标题</span>}
      </div>
    </div>
  )
}
