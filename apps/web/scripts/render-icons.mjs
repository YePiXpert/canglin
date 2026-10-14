// 生成 PWA / iOS 的 PNG 图标：用已安装的 Playwright Chromium 把 SVG 渲染成 PNG（本机没有 rsvg / ImageMagick）。
// 图形与 public/favicon.svg 一致：朱砂底（--color-accent #b6432a）+ 白色线描方盒，铺满整张图、不留透明边。
//   - public/apple-touch-icon.png       180 × 180：iOS 主屏图标，系统自己切圆角，图形约占 56%
//   - public/icons/icon-maskable-512.png 512 × 512：manifest 的 maskable 图标，图形收在中心 60% 的安全区内
// 用法（仓库根目录）：node apps/web/scripts/render-icons.mjs
// 首次运行前需要装好浏览器：pnpm --filter @canglin/web exec playwright install chromium
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');

const ACCENT = '#b6432a';
/** favicon.svg 的方盒图形（24 × 24 视窗、2px 描边） */
const GLYPH = 'M21 8l-9-5-9 5v8l9 5 9-5V8zM3 8l9 5 9-5M12 13v8';

/** size：边长；glyphRatio：图形（24 视窗）占边长的比例 */
function iconSvg(size, glyphRatio) {
  const glyph = size * glyphRatio;
  const scale = glyph / 24;
  const offset = (size - glyph) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${ACCENT}"/>
  <g transform="translate(${offset} ${offset}) scale(${scale})" fill="none" stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="${GLYPH}"/>
  </g>
</svg>`;
}

const targets = [
  { file: 'apple-touch-icon.png', size: 180, glyphRatio: 0.56 },
  // maskable：安全区是半径 40%（直径 80%）的圆。图形视窗占 50%，视窗的角离圆心 0.25 × √2 ≈ 0.35 个边长，
  // 方盒本身只占视窗的 75%，整个图形落在中心 60% 的方框与安全圆以内
  { file: 'icons/icon-maskable-512.png', size: 512, glyphRatio: 0.5 },
];

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, glyphRatio } of targets) {
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0">${iconSvg(size, glyphRatio)}</body></html>`);
    const out = path.join(publicDir, file);
    await page.screenshot({ path: out, clip: { x: 0, y: 0, width: size, height: size } });
    console.log(`wrote public/${file} (${size}×${size})`);
  }
} finally {
  await browser.close();
}
