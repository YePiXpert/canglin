import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  /*
   * 两组分开跑，各自启动 webServer（每次一个新的临时 SQLite）：
   * functional 是浏览器流程（test:e2e）；visual 是视觉回归（test:visual，要全新的数据库，
   * 在固定的 Playwright 容器里跑，见 scripts/visual.sh 与 CI 的 visual job）。
   */
  projects: [
    { name: 'functional', testIgnore: /visual\.spec\.ts/ },
    { name: 'visual', testMatch: /visual\.spec\.ts/ },
  ],
  use: {
    actionTimeout: 10_000,
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {},
    baseURL: 'http://127.0.0.1:5174',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'node ../server/test/browser-server.cjs',
      url: 'http://127.0.0.1:3301/api/health',
      timeout: 60_000,
    },
    {
      command: 'pnpm exec vite --host 127.0.0.1 --port 5174 --strictPort',
      url: 'http://127.0.0.1:5174',
      env: { API_PROXY_TARGET: 'http://127.0.0.1:3301' },
    },
  ],
});
