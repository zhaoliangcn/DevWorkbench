import { Editor } from '@monaco-editor/react'
import type * as monacoNs from 'monaco-editor'
import { useAppStore } from '../../../store/appStore'
import { useExplorerStore } from '../../../store/explorerStore'
import './monacoSetup'

// monaco 文件编辑器：本地化 monaco（见 monacoSetup.ts）+ Ctrl+S 保存 + 只读锁定。

export function FileEditor({ tabId }: { tabId: string }) {
  const theme = useAppStore((s) => s.theme)
  const tab = useExplorerStore((s) => s.tabs.find((t) => t.id === tabId))
  const updateContent = useExplorerStore((s) => s.updateContent)

  if (!tab) return null

  const handleMount = (editor: monacoNs.editor.IStandaloneCodeEditor, monaco: typeof monacoNs) => {
    // Ctrl/Cmd+S 保存（monaco 拦截内部键盘事件，需 addCommand 注册）
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
      const id = useExplorerStore.getState().activeTabId
      if (id) void useExplorerStore.getState().saveTab(id)
    })
  }

  return (
    <Editor
      className="editor-monaco"
      height="100%"
      language={tab.language}
      theme={theme === 'dark' ? 'vs-dark' : 'vs'}
      value={tab.content}
      onChange={(v) => updateContent(tab.id, v ?? '')}
      onMount={handleMount}
      loading={<div className="editor-loading">编辑器加载中…</div>}
      options={{
        readOnly: tab.locked,
        fontSize: 13,
        minimap: { enabled: false },
        automaticLayout: true,
        scrollBeyondLastLine: false,
        tabSize: 2,
      }}
    />
  )
}
