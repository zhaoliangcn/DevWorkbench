/**
 * Docker CLI `--format "{{json .}}"` 输出解析（附录 B.6.1）。
 * 纯函数层：主进程通道保持薄，逐行 JSON 解析与字段映射在此完成以便测试。
 */

/** 逐行解析 JSON，跳过空行与坏行（docker 偶发 warning 混入 stdout） */
export function parseDockerJsonLines(raw: string): Record<string, string>[] {
  const out: Record<string, string>[] = []
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t) continue
    try {
      const obj = JSON.parse(t)
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        out.push(obj as Record<string, string>)
      }
    } catch {
      // 非 JSON 行忽略
    }
  }
  return out
}

export interface DockerContainerRow {
  id: string
  name: string
  image: string
  state: string
  status: string
  ports: string
  createdAt: string
}

export function toContainerRows(raw: string): DockerContainerRow[] {
  return parseDockerJsonLines(raw).map((o) => ({
    id: (o.ID ?? '').slice(0, 12),
    name: (o.Names ?? '').replace(/^\//, ''),
    image: o.Image ?? '',
    state: o.State ?? '',
    status: o.Status ?? '',
    ports: o.Ports ?? '',
    createdAt: o.CreatedAt ?? '',
  }))
}

export interface DockerImageRow {
  repository: string
  tag: string
  id: string
  created: string
  size: string
}

export function toImageRows(raw: string): DockerImageRow[] {
  return parseDockerJsonLines(raw).map((o) => ({
    repository: o.Repository ?? '',
    tag: o.Tag ?? '',
    id: (o.ID ?? '').replace(/^sha256:/, '').slice(0, 12),
    created: o.CreatedSince ?? o.CreatedAt ?? '',
    size: o.Size ?? '',
  }))
}
