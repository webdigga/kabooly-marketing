import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// In development the API runs under `wrangler dev` (port 8787); proxying
// /api keeps the browser on one origin, exactly as in production where the
// same Worker serves both the app and the API.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8787',
    },
  },
})
