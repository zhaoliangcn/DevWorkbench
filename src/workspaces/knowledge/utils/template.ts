export interface TemplateVars {
  /** 笔记标题（每日笔记即日期串） */
  title: string
  /** YYYY-MM-DD（本地时区） */
  date: string
}

/**
 * 模板占位符替换（附录 E E.3.4）：{{date}}/{{title}} 全局替换，
 * 未知占位符原样保留。用 split/join 而非 replace —— 替换值含 `$` 时
 * replace 的特殊替换语义会产生注入。
 */
export function renderTemplate(template: string, vars: TemplateVars): string {
  return template.split('{{date}}').join(vars.date).split('{{title}}').join(vars.title)
}

/** 本地时区的 YYYY-MM-DD（不用 toISOString —— UTC 会在东八区凌晨给出昨日日期） */
export function todayStr(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** vault/templates/ 约定目录前缀；该目录下 .md 视为模板而非笔记（附录 E E.3.4） */
export const TEMPLATE_DIR = 'templates/'

/** 内置每日笔记模板（vault/templates/daily.md 存在时覆盖之） */
export const DEFAULT_DAILY_TEMPLATE = `# {{date}}

## 任务

- [ ] 

## 记录

`
