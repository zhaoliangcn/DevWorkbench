import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// 生产构建注入 CSP（P0 配套）：仅 build 时注入，避免破坏 Vite dev 的 HMR 内联脚本。
// script-src 无 unsafe-inline → 即使 markdown 消毒被绕过，内联事件处理器也不执行；
// connect-src/img-src 放开是工具属性所致（AI 服务商/外链图片/WS 调试目标任意）。
const cspPlugin = (): Plugin => ({
  name: 'inject-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const csp = [
      "default-src 'self'",
      "script-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "img-src * data: blob:",
      "media-src * data: blob:",
      "font-src 'self' data:",
      "connect-src *",
      "worker-src 'self' blob:",
      "frame-src 'none'",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ')
    return html.replace(
      '<head>',
      `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
    )
  },
})

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  optimizeDeps: {
    include: ['monaco-editor', '@monaco-editor/react'],
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // 将体积较大的依赖拆分为独立 chunk，避免首屏阻塞
        manualChunks(id: string) {
          if (id.includes('monaco-editor') || id.includes('@monaco-editor')) {
            return 'monaco'
          }
          if (id.includes('@xterm')) {
            return 'xterm'
          }
          if (id.includes('/d3/') || id.includes('d3-')) {
            return 'd3'
          }
        },
      },
    },
  },
})
