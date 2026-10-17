import { resolve } from 'path'
import { defineConfig } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {},
  preload: {},
  renderer: {
    build: { minify: 'esbuild' },
    worker: {
      format: 'es',
      plugins: () => [
        {
          name: 'pdf-worker-exports',
          options: (options) => ({ ...options, preserveEntrySignatures: 'strict' })
        }
      ]
    },
    resolve: {
      alias: {
        '@': resolve('src/renderer/src'),
        '@renderer': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
