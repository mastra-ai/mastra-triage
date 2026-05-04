import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { hideApiPlugin } from './vite-plugins/hide-api'

export default defineConfig({
  plugins: [react(), tailwindcss(), hideApiPlugin()],
  server: {
    port: 3000,
  },
})
