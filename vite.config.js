import { defineConfig } from 'vite'

export default defineConfig({
  // Относительные пути — сборку можно выложить в любую папку (например, GitHub Pages)
  base: './',
  server: {
    // В dev-режиме ходим на KASE через прокси: у kase.kz нет CORS-заголовков
    proxy: {
      '/kase': {
        target: 'https://kase.kz',
        changeOrigin: true,
        // KASE отсекает часть ботовых User-Agent — отправляем нейтральный
        headers: { 'User-Agent': 'Mozilla/5.0 (hsbk-dashboard)' },
        rewrite: (p) => p.replace(/^\/kase/, ''),
      },
    },
  },
})
