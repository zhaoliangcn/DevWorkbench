export interface Note {
  id: string
  title: string
  content: string
  path: string
  createdAt: number
  updatedAt: number
  tags: string[]
}

export interface Folder {
  id: string
  name: string
  path: string
  children: TreeNode[]
}

export type TreeNode = Folder | NoteRef

export interface NoteRef {
  id: string
  title: string
  path: string
  kind: 'note'
}

export interface Link {
  source: string
  target: string
}

export type RightPanelTab = 'backlinks' | 'search' | 'tags' | 'graph' | 'ai' | 'mindmap'
export type EditorMode = 'edit' | 'preview' | 'split'
export type Theme = 'light' | 'dark'

export type AiProvider = 'ollama' | 'openai'

export interface AiConfig {
  provider: AiProvider
  endpoint: string
  model: string
  apiKey: string
  temperature: number
  maxTokens: number
}

export type AiAction = 'continue' | 'expand' | 'grammar' | 'summarize' | 'format'

export interface AiActionDef {
  id: AiAction
  label: string
  description: string
  prompt: string
}

export interface MindMapNode {
  id: string
  label: string
  level: number
  children: MindMapNode[]
}
