// All app icons share the editable geometry in public/favicon.svg.
// Run: PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium node apps/web/scripts/render-icons.mjs
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import process from 'node:process';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { chromium } = require('@playwright/test');
const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const source = readFileSync(path.join(publicDir, 'favicon.svg'), 'utf8');
const glyph = source.replace(/<svg[^>]*>|<\/svg>/g, '').replace(/<rect[^>]*\/>/, '');
const targets = [
  { file: 'icons/icon-192.png', size: 192 },
  { file: 'icons/icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180, safe: 0.8 },
  { file: 'icons/icon-maskable-512.png', size: 512, safe: 0.72 },
];
const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
try {
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  for (const { file, size, safe } of targets) {
    const offset = size * (1 - (safe || 1)) / 2;
    const svg = safe
      ? `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="#b6432a"/><g transform="translate(${offset} ${offset}) scale(${size * safe / 32})">${glyph}</g></svg>`
      : source.replace('<svg ', `<svg width="${size}" height="${size}" `);
    await page.setViewportSize({ width: size, height: size });
    await page.setContent(`<!doctype html><html><body style="margin:0">${svg}</body></html>`);
    await page.screenshot({ path: path.join(publicDir, file), clip: { x: 0, y: 0, width: size, height: size }, omitBackground: !safe });
    console.log(`wrote public/${file} (${size}×${size})`);
  }
} finally { await browser.close(); }
