import { useState, useRef, useEffect, useCallback } from 'react'
import { useStore } from '../../../store/knowledgeStore'
import { marked } from 'marked'
import type { EditorMode } from '../../../types'
import { Edit3, Eye, Columns, Bold, Italic, Link, Code, FileDown, FileText, Pin, PinOff } from 'lucide-react'
import { exportToDocx, exportToPdf } from '../utils/export'

marked.setOptions({
  breaks: true,
  gfm: true,
})

function renderMarkdown(content: string): string {
  let html = content

  html = html.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, title) => {
      const cleanTitle = title.split('|')[0].trim()
      return `<a class="wiki-link" data-note-title="${cleanTitle}" href="#">${cleanTitle}</a>`
    }
  )

  const rawHtml = marked.parse(html) as string
  return rawHtml
}

export default function MarkdownEditor() {
  const activeNoteId = useStore((s) => s.activeNoteId)
  const notes = useStore((s) => s.notes)
  const updateNoteContent = useStore((s) => s.updateNoteContent)
  const updateNoteTitle = useStore((s) => s.updateNoteTitle)
  const navigateToNote = useStore((s) => s.navigateToNote)
  const pinnedForAssistant = useStore((s) => s.pinnedForAssistant)
  const togglePinForAssistant = useStore((s) => s.togglePinForAssistant)

  const [mode, setMode] = useState<EditorMode>('edit')
  const [editingTitle, setEditingTitle] = useState(false)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)

  const activeNote = activeNoteId ? notes[activeNoteId] : null

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
          navigateToNote(noteTitle)
        }
      }
    }
    el.addEventListener('click', handleWikiClick)
    return () => {
      el.removeEventListener('click', handleWikiClick)
    }
  }, [activeNote?.content, navigateToNote])

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
      if (e.key === 'Tab') {
        e.preventDefault()
        insertFormatting('  ', '')
      }
    },
    [insertFormatting]
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
              onChange={(e) =>
                updateNoteContent(activeNote.id, e.target.value)
              }
              onKeyDown={handleKeyDown}
              placeholder="开始书写..."
              spellCheck={false}
            />
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
    </div>
  )
}
