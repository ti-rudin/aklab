import { fileURLToPath, URL } from 'node:url'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    vue(),
    vueDevTools(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    },
  },
  server: {
    port: parseInt(process.env.PORT_APP || '5174', 10),
    allowedHosts: ['aklab.tirobots.ru', 'localhost', '127.0.0.1'],
  },
  preview: {
    port: parseInt(process.env.PORT_APP || '5174', 10),
    allowedHosts: ['aklab.tirobots.ru', 'localhost', '127.0.0.1'],
  },
})