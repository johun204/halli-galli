import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icon.svg'],
      manifest: {
        name: '할리갈리',
        short_name: '할리갈리',
        description: '초대 링크로 친구를 불러 즐기는 온라인 할리갈리',
        theme_color: '#e6392f',
        background_color: '#fff8ea',
        display: 'standalone',
        start_url: '/',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
    }),
  ],
  server: {
    // 서버와 함께 쓰는 ../shared/types.ts를 개발 서버에서도 불러올 수 있게 허용
    fs: { allow: ['..'] },
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        ws: true,
      },
    },
  },
});
