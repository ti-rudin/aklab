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
    allowedHosts: ['aklab.tirobots.ru', 'aklab-dev.tirobots.ru', 'localhost', '127.0.0.1'],
    // В dev-режиме проксируем /api на локальный Strapi (1338),
    // чтобы избежать CORS-проблем и не хардкодить VITE_API_URL.
    proxy: {
      '/api': {
        target: process.env.VITE_API_URL?.replace(/\/api$/, '') || 'http://localhost:1338',
        changeOrigin: true,
      },
    },
  },
  preview: {
    port: parseInt(process.env.PORT_APP || '5174', 10),
    allowedHosts: ['aklab.tirobots.ru', 'aklab-dev.tirobots.ru', 'localhost', '127.0.0.1'],
  },
})