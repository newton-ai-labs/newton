import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// https://vitejs.dev/config/
export default defineConfig(() => {
  // NEWTON_CLIENT_PORT for client, NEWTON_PORT for backend proxy
  const clientPort = Number(process.env.NEWTON_CLIENT_PORT) || 5173
  const backendPort = Number(process.env.NEWTON_PORT) || 8787

  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    server: {
      port: clientPort,
      proxy: {
        '/api': {
          target: `http://localhost:${backendPort}`,
          changeOrigin: true,
        },
      },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            // Separate large vendor libraries
            'monaco': ['monaco-editor', '@monaco-editor/react'],
            'react-vendor': ['react', 'react-dom', 'zustand'],
          },
        },
      },
    },
  }
})
