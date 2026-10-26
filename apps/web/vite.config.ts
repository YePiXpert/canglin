/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import path from 'node:path';
/** 登录页页脚等处显示的版本号：构建时从 package.json 注入，与发布版本保持一致 */
const { version } = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string };
// Public icon paths have long-lived CDN/browser caches. Change every reference
// when either the vector source or one of the generated icons changes.
const brandAssets = ['favicon.svg', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
const brandRevision = createHash('sha256').update(Buffer.concat(brandAssets.map(file => readFileSync(path.resolve(__dirname, 'public', file))))).digest('hex').slice(0, 12);
const brandUrl = (file: string) => `/${file}?v=${brandRevision}`;

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version), __BRAND_REVISION__: JSON.stringify(brandRevision) },
  plugins: [
    vue(),
    tailwindcss(),
    {
      name: 'canglin-brand-icons',
      transformIndexHtml: html => html.replaceAll('href="/favicon.svg"', `href="${brandUrl('favicon.svg')}"`)
        .replaceAll('href="/apple-touch-icon.png"', `href="${brandUrl('apple-touch-icon.png')}"`)
        .replaceAll('src="/favicon.svg"', `src="${brandUrl('favicon.svg')}"`),
    },
    VitePWA({
      registerType: 'autoUpdate',
      manifestFilename: `manifest-${brandRevision}.webmanifest`,
      includeAssets: ['favicon.svg'],
      manifest: {
        id: '/',
        name: '仓廪 · 采购与领用',
        short_name: '仓廪',
        description: '办公用品采购与领用：OA 单导入、分次采购、到货入库、库存领用',
        theme_color: '#F8F6F1',
        background_color: '#F8F6F1',
        display: 'standalone',
        icons: [
          { src: brandUrl('icons/icon-192.png'), sizes: '192x192', type: 'image/png' },
          { src: brandUrl('icons/icon-512.png'), sizes: '512x512', type: 'image/png' },
          // Android 自适应图标：图形收在中心安全区（scripts/render-icons.mjs 生成）
          { src: brandUrl('icons/icon-maskable-512.png'), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        additionalManifestEntries: brandAssets.map(file => ({ url: brandUrl(file), revision: brandRevision })),
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
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
