function getAPI(): ElectronAPI | null {
  return window.electronAPI ?? null
}

export function isVaultOpen(): boolean {
  return getAPI() !== null
}

export async function openVault(): Promise<{ name: string } | null> {
  const api = getAPI()
  if (!api) return null
  const result = await api.vault.select()
  if (!result) return null
  return { name: result.name }
}

export async function tryRestoreVault(): Promise<{ name: string } | null> {
  const api = getAPI()
  if (!api) return null
  const name = await api.vault.getName()
  if (!name) return null
  return { name }
}

export function getVaultPath(): string | null {
  return null
}

export async function writeFile(relativePath: string, content: string): Promise<void> {
  const api = getAPI()
  if (!api) throw new Error('未打开 Vault 目录')
  await api.file.write(relativePath, content)
}

export async function readFile(relativePath: string): Promise<string> {
  const api = getAPI()
  if (!api) throw new Error('未打开 Vault 目录')
  const content = await api.file.read(relativePath)
  if (content === null) throw new Error(`文件不存在: ${relativePath}`)
  return content
}

export async function deleteFile(relativePath: string): Promise<void> {
  const api = getAPI()
  if (!api) throw new Error('未打开 Vault 目录')
  await api.file.delete(relativePath)
}

export async function moveFile(oldPath: string, newPath: string): Promise<void> {
  const api = getAPI()
  if (!api) throw new Error('未打开 Vault 目录')
  const content = await api.file.read(oldPath)
  if (content === null) throw new Error(`文件不存在: ${oldPath}`)
  await api.file.write(newPath, content)
  await api.file.delete(oldPath)
}

export async function createDirectory(relativePath: string): Promise<void> {
  const api = getAPI()
  if (!api) throw new Error('未打开 Vault 目录')
  await api.dir.create(relativePath)
}

export async function deleteDirectory(relativePath: string): Promise<void> {
  const api = getAPI()
  if (!api) throw new Error('未打开 Vault 目录')
  await api.dir.delete(relativePath)
}

export async function saveFileFromContent(
  relativePath: string,
  content: string
): Promise<void> {
  await writeFile(relativePath, content)
}

export async function exportFile(
  relativePath: string,
  content: string
): Promise<void> {
  const api = getAPI()
  if (api) {
    await api.file.export(relativePath, content)
    return
  }
  const fileName = relativePath.split('/').pop() || 'note.md'
  const blob = new Blob([content], { type: 'text/markdown' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}

export async function listAllFiles(): Promise<
  { path: string; name: string; content: string }[]
> {
  const api = getAPI()
  if (!api) return []
  return api.file.list()
}

export async function listDirectories(): Promise<string[]> {
  const api = getAPI()
  if (!api) return []
  return api.dir.list()
}

export function isFileSystemSupported(): boolean {
  return getAPI() !== null
}
