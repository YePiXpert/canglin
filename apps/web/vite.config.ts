/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
export default defineConfig({
  plugins: [
    vue(),
    tailwindcss(),
    VitePWA({
      // prompt 而非 autoUpdate：旧 SW 继续伺服旧的 precache，直到用户点「立即更新」。
      // autoUpdate 会在用户还开着页面时换掉 SW，旧页面再去加载已被删除的路由分片就会报错。
      registerType: 'prompt',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: '仓廪 · 采购与领用',
        short_name: '仓廪',
        description: '办公用品采购与领用：OA 单导入、分次采购、到货入库、库存领用',
        theme_color: '#F5F4F0',
        background_color: '#F5F4F0',
        display: 'standalone',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        navigateFallback: '/index.html',
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /^\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  build: {
    rollupOptions: {
      output: {
        // vue 生态是入口常驻依赖，成 vendor chunk 利于长缓存（内容 hash 不变就不失效）
        manualChunks(id: string): string | undefined {
          if (!id.includes('node_modules')) return undefined;
          if (/[\\/]node_modules[\\/](vue|@vue|vue-router|pinia|axios|reka-ui)([\\/]|$)/.test(id))
            return 'vendor';
          return undefined;
        },
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000',
        changeOrigin: true,
      },
    },
  },
});
