// 开发助手 explorer：文件扩展名分类与 monaco 语言映射

/** 图片扩展名（浏览器 <img> 可直接渲染；svg 归文本可编辑，icns 浏览器不支持） */
const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'ico'])

const LANGUAGE_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  json: 'json',
  jsonc: 'json',
  md: 'markdown',
  markdown: 'markdown',
  html: 'html',
  htm: 'html',
  xml: 'xml',
  svg: 'xml',
  vue: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  py: 'python',
  pyi: 'python',
  rs: 'rust',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  swift: 'swift',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  hh: 'cpp',
  cs: 'csharp',
  rb: 'ruby',
  php: 'php',
  pl: 'perl',
  lua: 'lua',
  dart: 'dart',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  bat: 'bat',
  cmd: 'bat',
  ps1: 'powershell',
  sql: 'sql',
  yml: 'yaml',
  yaml: 'yaml',
  toml: 'ini',
  ini: 'ini',
  cfg: 'ini',
  conf: 'ini',
  properties: 'ini',
  env: 'ini',
  graphql: 'graphql',
  gql: 'graphql',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
}

export function extOf(relPath: string): string {
  const base = relPath.split('/').pop() ?? relPath
  const lower = base.toLowerCase()
  if (lower === 'dockerfile' || lower === 'makefile') return lower
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

export function isImageExt(ext: string): boolean {
  return IMAGE_EXTENSIONS.has(ext)
}

/** monaco 语言 id（未知扩展名回落 plaintext） */
export function monacoLanguageOf(relPath: string): string {
  return LANGUAGE_MAP[extOf(relPath)] ?? 'plaintext'
}

/** 人读的文件大小 */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
