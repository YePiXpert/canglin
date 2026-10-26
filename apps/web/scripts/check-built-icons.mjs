// Verify real build output: a new icon must escape immutable CDN/browser caches,
// and its versioned URL must also be available in the offline precache.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const files = ['favicon.svg', 'apple-touch-icon.png', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png'];
const expected = createHash('sha256').update(Buffer.concat(files.map(file => readFileSync(path.join(root, 'public', file))))).digest('hex').slice(0, 12);
const html = readFileSync(path.join(dist, 'index.html'), 'utf8');
const links = html.match(/<link\b[^>]*>/g) || [];
function href(rel) {
  const tag = links.find(tag => tag.includes(`rel="${rel}"`));
  assert(tag, `Missing ${rel} link`);
  return tag.match(/href="([^"]+)"/)[1];
}
const manifestPath = href('manifest');
assert.equal(manifestPath, `/manifest-${expected}.webmanifest`);
const manifest = JSON.parse(readFileSync(path.join(dist, manifestPath.slice(1)), 'utf8'));
assert.equal(manifest.id, '/');
const urls = [href('icon'), href('apple-touch-icon'), ...manifest.icons.map(icon => icon.src)];
assert.equal(urls.length, 5);
const serviceWorker = readFileSync(path.join(dist, 'sw.js'), 'utf8');
for (const value of urls) {
  const url = new URL(value, 'https://app.invalid');
  assert.equal(url.searchParams.get('v'), expected, `Unversioned icon: ${value}`);
  assert(readFileSync(path.join(dist, url.pathname.slice(1))).length > 0, `Missing icon: ${value}`);
  assert(serviceWorker.includes(value), `Icon missing from offline cache: ${value}`);
}
assert(html.includes(`src="/favicon.svg?v=${expected}"`), 'Boot icon is not versioned');
const bundles = readdirSync(path.join(dist, 'assets')).filter(file => file.endsWith('.js')).map(file => readFileSync(path.join(dist, 'assets', file), 'utf8'));
assert(bundles.some(bundle => bundle.includes(`/favicon.svg?v=${expected}`)), 'App brand icon is not versioned');
console.log(`Brand icons verified: ${expected}, 5 versioned URLs, stable app identity and offline cache`);
