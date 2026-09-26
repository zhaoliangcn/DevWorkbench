// 正则测试纯函数（切片 G，设计 C.3）。
// 与主进程 electron/ipc/assistant-tools.ts 的 toolbox_regex 成对实现
// （electron tsconfig rootDir 限制无法共享源码，两侧均保持极薄）。
//
// 相比原组件实现的两点修正：
// 1. g 模式下空匹配（如 /a*/）时手动推进 lastIndex，避免死循环挂死
// 2. maxMatches 上限防止灾难性大输出

export interface RegexMatch {
  match: string
  groups: (string | undefined)[]
  index: number
}

export interface RegexInput {
  pattern: string
  flags: string
  text: string
  /** 最大匹配数，默认 1000 */
  maxMatches?: number
}

export interface RegexOutput {
  matches: RegexMatch[]
  error?: string
}

export function regexTest(input: RegexInput): RegexOutput {
  const { pattern, flags, text } = input
  const maxMatches = input.maxMatches ?? 1000
  let regex: RegExp
  try {
    regex = new RegExp(pattern, flags)
  } catch (e) {
    return { matches: [], error: (e as Error).message }
  }

  const results: RegexMatch[] = []
  let m: RegExpExecArray | null
  while ((m = regex.exec(text)) !== null) {
    results.push({ match: m[0], groups: m.slice(1), index: m.index })
    if (!regex.global || m[0] === '') {
      // 非 g 模式只取第一个；g 模式空匹配时 lastIndex 不前进，手动 +1 防死循环
      if (regex.global) regex.lastIndex++
      else break
    }
    if (results.length >= maxMatches) break
  }
  return { matches: results }
}
