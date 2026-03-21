import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        mobile: resolve(__dirname, 'mobile.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        display: resolve(__dirname, 'display.html'),
      },
    },
  },
})
