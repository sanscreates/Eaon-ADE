import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve('src/main/index.ts'),
          // Forked as a utilityProcess, so it has to be its own entry rather
          // than get folded into the main bundle.
          'stt-child': resolve('src/main/stt/child.ts'),
          // Launched by MCP clients as their own stdio process.
          'brain-mcp': resolve('src/main/brain/mcp-server.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: { input: { index: resolve('src/preload/index.ts') } }
    }
  },
  renderer: {
    root: resolve('src/renderer'),
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@shared': resolve('src/shared')
      }
    },
    build: {
      rollupOptions: { input: { index: resolve('src/renderer/index.html') } }
    },
    plugins: [react()]
  }
})
