import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: '/plannerown/',
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      registerType: 'autoUpdate',
      injectManifest: { globPatterns: ['**/*.{js,css,html,png,svg}'] },
      manifest: {
        name: 'Планер',
        short_name: 'Планер',
        description: 'Задачі, гроші, борги і Claude в одному місці',
        lang: 'uk',
        theme_color: '#ffffff',
        background_color: '#f6f7fb',
        display: 'standalone',
        start_url: '/plannerown/',
        scope: '/plannerown/',
        icons: [
          { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
    }),
  ],
});
