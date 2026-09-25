import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
