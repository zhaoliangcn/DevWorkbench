import type { AiConfig, AiAction } from '../../../types'

const ACTION_PROMPTS: Record<AiAction, string> = {
  continue:
    '你是一个专业的写作助手。请根据以下 Markdown 内容，从末尾自然流畅地续写，保持相同的风格和语气。只输出续写内容，不要重复原文，不要加任何解释。',
  expand:
    '你是一个专业的写作助手。请对以下选中的文本进行扩写，增加更多细节、例子或论证，使内容更加丰富充实。保持 Markdown 格式。只输出扩写后的内容，不要加任何解释。',
  grammar:
    '你是一个专业的文字校对助手。请检查以下 Markdown 文本的语法错误、错别字和标点问题，并输出修正后的完整文本。保持原有的 Markdown 格式不变。只输出修正后的内容，不要加任何解释。',
  summarize:
    '你是一个专业的写作助手。请对以下 Markdown 内容生成一个简洁的摘要，提取核心要点。使用 Markdown 列表格式输出。只输出摘要内容，不要加任何解释。',
  format:
    '你是一个专业的排版助手。请优化以下 Markdown 文本的格式，包括：统一标题层级、规范列表缩进、优化段落间距、美化表格等。保持内容不变，只改进排版。只输出格式化后的内容，不要加任何解释。',
}

export function getActionPrompt(action: AiAction): string {
  return ACTION_PROMPTS[action]
}

export async function callAi(
  config: AiConfig,
  action: AiAction,
  content: string,
  onChunk?: (chunk: string) => void
): Promise<string> {
  const systemPrompt = getActionPrompt(action)

  const body = JSON.stringify({
    model: config.model,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: content },
    ],
    temperature: config.temperature,
    max_tokens: config.maxTokens,
    stream: !!onChunk,
  })

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  }

  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  const endpoint = config.endpoint.replace(/\/+$/, '') + '/chat/completions'

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body,
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(`AI 请求失败 (${response.status}): ${errorText}`)
  }

  if (onChunk && response.body) {
    return readStream(response.body, onChunk)
  }

  const data = await response.json()
  return data.choices?.[0]?.message?.content || ''
}

async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (chunk: string) => void
): Promise<string> {
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let fullContent = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    const text = decoder.decode(value, { stream: true })
    const lines = text.split('\n')

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const content = parsed.choices?.[0]?.delta?.content || ''
        if (content) {
          fullContent += content
          onChunk(content)
        }
      } catch {
        // skip unparseable chunks
      }
    }
  }

  return fullContent
}

export function getDefaultConfig(provider: 'ollama' | 'openai'): AiConfig {
  if (provider === 'ollama') {
    return {
      provider: 'ollama',
      endpoint: 'http://localhost:11434/v1',
      model: 'qwen2.5:7b',
      apiKey: '',
      temperature: 0.7,
      maxTokens: 2048,
    }
  }

  return {
    provider: 'openai',
    endpoint: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    apiKey: '',
    temperature: 0.7,
    maxTokens: 2048,
  }
}
