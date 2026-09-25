import express, { Request, Response, NextFunction } from 'express'
import cors from 'cors'
import fs from 'node:fs'
import path from 'node:path'
import type { ApiConfig } from './api-config'

const app = express()
let server: ReturnType<typeof app.listen> | null = null
let vaultDir: string | null = null
let storedApiKey: string = ''

app.use(cors())
app.use(express.json({ limit: '10mb' }))

// Types
interface Note {
  id: string
  title: string
  content: string
  path: string
  createdAt: number
  updatedAt: number
  tags: string[]
}

interface Folder {
  id: string
  name: string
  path: string
}

// Helpers
function extractTags(content: string): string[] {
  const regex = /#([\w\u4e00-\u9fff-]+)/g
  const matches = content.match(regex)
  if (!matches) return []
  return [...new Set(matches.map((t) => t.slice(1)))]
}

function extractWikiLinks(content: string): string[] {
  const regex = /\[\[([^\]]+)\]\]/g
  const links: string[] = []
  let match
  while ((match = regex.exec(content)) !== null) {
    links.push(match[1].split('|')[0].trim())
  }
  return [...new Set(links)]
}

function sanitizeFileName(name: string): string {
  return name.replace(/[<>:"/\\|?*]/g, '-').trim() || 'untitled'
}

function resolveSafe(relativePath: string): string {
  if (!vaultDir) throw new Error('Vault not initialized')
  const resolved = path.resolve(vaultDir, relativePath)
  if (!resolved.startsWith(vaultDir)) {
    throw new Error('Path traversal detected')
  }
  return resolved
}

function readAllNotes(): Note[] {
  if (!vaultDir || !fs.existsSync(vaultDir)) return []
  
  const notes: Note[] = []
  
  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(full, rel)
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        const content = fs.readFileSync(full, 'utf-8')
        const stats = fs.statSync(full)
        const title = entry.name.replace(/\.md$/i, '')
        notes.push({
          id: rel.replace(/\.md$/i, ''),
          title,
          content,
          path: rel,
          createdAt: stats.birthtime.getTime(),
          updatedAt: stats.mtime.getTime(),
          tags: extractTags(content),
        })
      }
    }
  }
  
  walk(vaultDir, '')
  return notes
}

function findNoteById(id: string): Note | null {
  const notes = readAllNotes()
  return notes.find((n) => n.id === id) || notes.find((n) => n.path === id) || null
}

function getAllFolders(): Folder[] {
  if (!vaultDir || !fs.existsSync(vaultDir)) return []
  
  const folders: Folder[] = []
  
  function walk(dir: string, prefix: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name
        folders.push({
          id: rel,
          name: entry.name,
          path: rel,
        })
        walk(path.join(dir, entry.name), rel)
      }
    }
  }
  
  walk(vaultDir, '')
  return folders
}

function getAllTags(): string[] {
  const notes = readAllNotes()
  const tagSet = new Set<string>()
  for (const note of notes) {
    for (const tag of note.tags) {
      tagSet.add(tag)
    }
  }
  return [...tagSet].sort()
}

function extractTitleFromContent(content: string): string {
  const match = content.match(/^#\s+(.+)$/m)
  if (match) return match[1].trim()
  const firstLine = content.split('\n')[0]
  if (firstLine) return firstLine.trim()
  return 'Untitled'
}

// Auth middleware
function authMiddleware(req: Request, res: Response, next: NextFunction) {
  const apiKey = req.headers['x-api-key'] as string
  if (!apiKey || apiKey !== storedApiKey) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }
  next()
}

// Health check (no auth required)
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', vault: vaultDir })
})

// Apply auth to all other routes
app.use('/api', authMiddleware)

// ============ Vault Routes ============

app.get('/api/vault', (_req: Request, res: Response) => {
  res.json({
    path: vaultDir,
    name: vaultDir ? path.basename(vaultDir) : null,
    noteCount: readAllNotes().length,
    folderCount: getAllFolders().length,
    tagCount: getAllTags().length,
  })
})

// ============ Note Routes ============

app.get('/api/notes', (req: Request, res: Response) => {
  try {
    const notes = readAllNotes()
    const { q, tag, folder, limit, offset } = req.query
    
    let filtered = notes
    
    // Search by query
    if (q && typeof q === 'string') {
      const query = q.toLowerCase()
      filtered = filtered.filter(
        (n) =>
          n.title.toLowerCase().includes(query) ||
          n.content.toLowerCase().includes(query) ||
          n.tags.some((t) => t.toLowerCase().includes(query))
      )
    }
    
    // Filter by tag
    if (tag && typeof tag === 'string') {
      filtered = filtered.filter((n) => n.tags.includes(tag))
    }
    
    // Filter by folder
    if (folder && typeof folder === 'string') {
      filtered = filtered.filter((n) => n.path.startsWith(folder))
    }
    
    const total = filtered.length
    
    // Pagination
    const limitNum = limit ? parseInt(limit as string, 10) : 50
    const offsetNum = offset ? parseInt(offset as string, 10) : 0
    filtered = filtered.slice(offsetNum, offsetNum + limitNum)
    
    // Optionally strip content for list view
    const summary = req.query.summary === 'true'
    const result = summary
      ? filtered.map(({ content: _content, ...rest }) => rest)
      : filtered
    
    res.json({ notes: result, total, limit: limitNum, offset: offsetNum })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/notes/:id', (req: Request, res: Response) => {
  try {
    const noteId = req.params.id as string
    const note = findNoteById(noteId)
    if (!note) {
      return res.status(404).json({ error: 'Note not found' })
    }
    
    // Get backlinks and outlinks
    const notes = readAllNotes()
    const titleToId = new Map<string, string>()
    for (const n of notes) {
      titleToId.set(n.title, n.id)
    }
    
    const outlinks = extractWikiLinks(note.content)
      .map((title) => titleToId.get(title))
      .filter(Boolean)
    
    const backlinks = notes
      .filter((n) => {
        const links = extractWikiLinks(n.content)
        return links.includes(note.title)
      })
      .map((n) => n.id)
    
    res.json({ ...note, backlinks, outlinks })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/notes', (req: Request, res: Response) => {
  try {
    const { title, content, folderPath } = req.body
    
    if (!title && !content) {
      return res.status(400).json({ error: 'Title or content is required' })
    }
    
    const noteTitle = title || extractTitleFromContent(content || '')
    const noteContent = content || `# ${noteTitle}\n`
    const fileName = sanitizeFileName(noteTitle) + '.md'
    const relativePath = folderPath ? `${folderPath}/${fileName}` : fileName
    const fullPath = resolveSafe(relativePath)
    
    // Create directory if needed
    const dir = path.dirname(fullPath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    
    // Check if file already exists
    if (fs.existsSync(fullPath)) {
      return res.status(409).json({ error: 'Note already exists' })
    }
    
    fs.writeFileSync(fullPath, noteContent, 'utf-8')
    
    const note: Note = {
      id: relativePath.replace(/\.md$/i, ''),
      title: noteTitle,
      content: noteContent,
      path: relativePath,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      tags: extractTags(noteContent),
    }
    
    res.status(201).json(note)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.put('/api/notes/:id', (req: Request, res: Response) => {
  try {
    const noteId = req.params.id as string
    const note = findNoteById(noteId)
    if (!note) {
      return res.status(404).json({ error: 'Note not found' })
    }
    
    const { title, content } = req.body
    const fullPath = resolveSafe(note.path)
    
    let newContent = content || note.content
    const newTitle = title || note.title
    
    // Update title in content if provided
    if (title && !content) {
      newContent = newContent.replace(/^#\s+.+$/m, `# ${title}`)
    }
    
    // Update file
    fs.writeFileSync(fullPath, newContent, 'utf-8')
    
    // If title changed, rename file
    if (title && title !== note.title) {
      const newFileName = sanitizeFileName(title) + '.md'
      const dir = path.dirname(note.path)
      const newRelativePath = dir === '.' ? newFileName : `${dir}/${newFileName}`
      const newFullPath = resolveSafe(newRelativePath)
      
      fs.renameSync(fullPath, newFullPath)
      
      const updatedNote: Note = {
        ...note,
        title: newTitle,
        content: newContent,
        path: newRelativePath,
        id: newRelativePath.replace(/\.md$/i, ''),
        updatedAt: Date.now(),
        tags: extractTags(newContent),
      }
      return res.json(updatedNote)
    }
    
    const updatedNote: Note = {
      ...note,
      title: newTitle,
      content: newContent,
      updatedAt: Date.now(),
      tags: extractTags(newContent),
    }
    
    res.json(updatedNote)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/notes/:id', (req: Request, res: Response) => {
  try {
    const noteId = req.params.id as string
    const note = findNoteById(noteId)
    if (!note) {
      return res.status(404).json({ error: 'Note not found' })
    }
    
    const fullPath = resolveSafe(note.path)
    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath)
    }
    
    res.json({ success: true, deleted: note.id })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ============ Import/Export Routes ============

app.post('/api/notes/import', (req: Request, res: Response) => {
  try {
    const { notes: importNotes, folderPath } = req.body
    
    if (!Array.isArray(importNotes)) {
      return res.status(400).json({ error: 'notes must be an array' })
    }
    
    const results: Note[] = []
    
    for (const item of importNotes) {
      const { title, content } = item
      if (!content) continue
      
      const noteTitle = title || extractTitleFromContent(content)
      const fileName = sanitizeFileName(noteTitle) + '.md'
      const relativePath = folderPath ? `${folderPath}/${fileName}` : fileName
      const fullPath = resolveSafe(relativePath)
      
      const dir = path.dirname(fullPath)
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }
      
      // Handle duplicate names
      let finalPath = fullPath
      let finalRelativePath = relativePath
      let counter = 1
      while (fs.existsSync(finalPath)) {
        const newFileName = sanitizeFileName(noteTitle) + ` (${counter}).md`
        finalRelativePath = folderPath ? `${folderPath}/${newFileName}` : newFileName
        finalPath = resolveSafe(finalRelativePath)
        counter++
      }
      
      fs.writeFileSync(finalPath, content, 'utf-8')
      
      const note: Note = {
        id: finalRelativePath.replace(/\.md$/i, ''),
        title: noteTitle,
        content,
        path: finalRelativePath,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        tags: extractTags(content),
      }
      
      results.push(note)
    }
    
    res.status(201).json({ imported: results.length, notes: results })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ============ Search Routes ============

app.get('/api/search', (req: Request, res: Response) => {
  try {
    const { q, tag, folder } = req.query
    
    if (!q && !tag) {
      return res.status(400).json({ error: 'Query (q) or tag is required' })
    }
    
    const notes = readAllNotes()
    let results = notes
    
    if (q && typeof q === 'string') {
      const query = q.toLowerCase()
      results = results.filter(
        (n) =>
          n.title.toLowerCase().includes(query) ||
          n.content.toLowerCase().includes(query)
      )
    }
    
    if (tag && typeof tag === 'string') {
      results = results.filter((n) => n.tags.includes(tag))
    }
    
    if (folder && typeof folder === 'string') {
      results = results.filter((n) => n.path.startsWith(folder))
    }
    
    // Return summaries by default
    const summary = req.query.summary !== 'false'
    const result = summary
      ? results.map(({ content: _content, ...rest }) => rest)
      : results
    
    res.json({ results: result, count: result.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ============ Tag Routes ============

app.get('/api/tags', (_req: Request, res: Response) => {
  try {
    const tags = getAllTags()
    const notes = readAllNotes()
    
    const tagsWithCount = tags.map((tag) => ({
      name: tag,
      count: notes.filter((n) => n.tags.includes(tag)).length,
    }))
    
    res.json({ tags: tagsWithCount })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ============ Link Routes ============

app.get('/api/links', (_req: Request, res: Response) => {
  try {
    const notes = readAllNotes()
    const titleToId = new Map<string, string>()
    
    for (const note of notes) {
      titleToId.set(note.title, note.id)
    }
    
    const links: { source: string; target: string }[] = []
    
    for (const note of notes) {
      const wikiLinks = extractWikiLinks(note.content)
      for (const targetTitle of wikiLinks) {
        const targetId = titleToId.get(targetTitle)
        if (targetId && targetId !== note.id) {
          links.push({ source: note.id, target: targetId })
        }
      }
    }
    
    res.json({ links, nodeCount: notes.length, linkCount: links.length })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.get('/api/notes/:id/connections', (req: Request, res: Response) => {
  try {
    const noteId = req.params.id as string
    const note = findNoteById(noteId)
    if (!note) {
      return res.status(404).json({ error: 'Note not found' })
    }
    
    const notes = readAllNotes()
    const titleToId = new Map<string, string>()
    for (const n of notes) {
      titleToId.set(n.title, n.id)
    }
    
    const outlinks = extractWikiLinks(note.content)
      .map((title) => {
        const id = titleToId.get(title)
        return id ? { id, title } : null
      })
      .filter(Boolean)
    
    const backlinks = notes
      .filter((n) => {
        const links = extractWikiLinks(n.content)
        return links.includes(note.title)
      })
      .map((n) => ({ id: n.id, title: n.title }))
    
    res.json({ noteId: note.id, outlinks, backlinks })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ============ Folder Routes ============

app.get('/api/folders', (_req: Request, res: Response) => {
  try {
    const folders = getAllFolders()
    res.json({ folders })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.post('/api/folders', (req: Request, res: Response) => {
  try {
    const { name, parentPath } = req.body
    
    if (!name) {
      return res.status(400).json({ error: 'Folder name is required' })
    }
    
    const relativePath = parentPath ? `${parentPath}/${name}` : name
    const fullPath = resolveSafe(relativePath)
    
    if (fs.existsSync(fullPath)) {
      return res.status(409).json({ error: 'Folder already exists' })
    }
    
    fs.mkdirSync(fullPath, { recursive: true })
    
    const folder: Folder = {
      id: relativePath,
      name,
      path: relativePath,
    }
    
    res.status(201).json(folder)
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

app.delete('/api/folders/:path', (req: Request, res: Response) => {
  try {
    const folderPath = req.params.path as string
    const fullPath = resolveSafe(folderPath)
    
    if (!fs.existsSync(fullPath)) {
      return res.status(404).json({ error: 'Folder not found' })
    }
    
    fs.rmSync(fullPath, { recursive: true })
    
    res.json({ success: true, deleted: folderPath })
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// ============ Server Functions ============

export function startApiServer(config: ApiConfig): Promise<number> {
  return new Promise((resolve, reject) => {
    storedApiKey = config.apiKey
    
    server = app.listen(config.port, config.host, () => {
      console.log(`[API] Server running on http://${config.host}:${config.port}`)
      console.log(`[API] API Key: ${config.apiKey}`)
      resolve(config.port)
    })
    
    server.on('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'EADDRINUSE') {
        console.log(`[API] Port ${config.port} in use, trying ${config.port + 1}`)
        server = app.listen(config.port + 1, config.host, () => {
          console.log(`[API] Server running on http://${config.host}:${config.port + 1}`)
          console.log(`[API] API Key: ${config.apiKey}`)
          resolve(config.port + 1)
        })
      } else {
        reject(err)
      }
    })
  })
}

export function stopApiServer(): void {
  if (server) {
    server.close()
    server = null
    console.log('[API] Server stopped')
  }
}

export function setVaultPath(p: string): void {
  vaultDir = p
}
