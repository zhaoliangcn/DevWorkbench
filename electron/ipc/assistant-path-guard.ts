import path from 'node:path'

/**
 * 宿主侧文件工具路径守卫（对冲上游 dev-assistant-ts 的路径围栏缺口）。
 *
 * 背景：上游 tools/file/common.ts 的 resolveInWorkDir 对绝对路径原样放行
 * （修复已在 dev-assistant-ts 仓库落地但尚未发布），模型被提示词注入后可用
 * write_file/read_file 逃出 workingDir。此守卫在宿主的工具执行包装层
 * （launchApp 内、最内层）按参数拦截越界路径，独立于上游版本生效。
 *
 * 纯函数 + 注入式校验，vitest 直测。
 */

/** 文件类工具 → 需要校验的路径参数（与上游 tools/ 的 spec 参数名对齐） */
export const PATH_ARG_TOOLS: Record<string, { key: string; list?: boolean }> = {
  read_file: { key: 'path' },
  write_file: { key: 'path' },
  edit_file: { key: 'path' },
  read_symbol: { key: 'path' },
  file_exists: { key: 'path' },
  list_directory: { key: 'path' },
  batch_read: { key: 'paths', list: true },
  glob: { key: 'cwd' },
}

/** 路径是否落在 root 内（win32 大小写不敏感；词法校验，与 vault.resolveSafe 同策略） */
export function isInsideRoot(root: string, resolved: string): boolean {
  const lc = (p: string) => (process.platform === 'win32' ? p.toLowerCase() : p)
  const nRoot = lc(path.resolve(root)).replace(/[\\/]+$/, '')
  const nResolved = lc(path.resolve(resolved))
  return nResolved === nRoot || nResolved.startsWith(nRoot + path.sep)
}

function resolveLexical(root: string, p: string): string {
  return path.isAbsolute(p) ? path.normalize(p) : path.resolve(path.resolve(root), p)
}

/**
 * 检查工具调用的路径参数是否全部位于 workingDir 内。
 * @returns 首个越界路径（用于报错）；null = 全部合规或该工具无路径参数
 */
export function findOutsidePath(
  toolName: string,
  args: Record<string, unknown>,
  workingDir: string,
): string | null {
  const spec = PATH_ARG_TOOLS[toolName]
  if (!spec || typeof args !== 'object' || args === null) return null

  const raw = args[spec.key]
  const candidates: unknown[] = spec.list
    ? (Array.isArray(raw) ? raw : [raw])
    : [raw]

  for (const c of candidates) {
    if (typeof c !== 'string' || c.trim().length === 0) continue
    if (!isInsideRoot(workingDir, resolveLexical(workingDir, c))) {
      return c
    }
  }
  return null
}
