/**
 * 测试环境准备：为每个 vitest 进程创建独立临时数据目录，
 * 并把 schema push 到测试数据库。setupFiles 在测试文件导入模块之前执行。
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { afterAll } from 'vitest';

const dataDir = mkdtempSync(path.join(tmpdir(), 'canglin-test-'));
// 每个测试文件跑完后删掉临时数据目录，避免 /tmp 里堆积测试库（vitest 工作进程不一定正常 exit）
afterAll(() => rmSync(dataDir, { recursive: true, force: true }));
process.env.DATA_DIR = dataDir;
process.env.OCR_BASE_URL = 'http://127.0.0.1:59999'; // 不会真实调用

const databaseUrl = `file:${path.join(dataDir, 'procure.db').replace(/\\/g, '/')}`;
process.env.DATABASE_URL = databaseUrl;

execSync('npx prisma db push --skip-generate --accept-data-loss', {
  cwd: path.resolve(__dirname, '..'),
  env: { ...process.env, DATABASE_URL: databaseUrl },
  stdio: 'pipe',
});

export const TEST_DATA_DIR = dataDir;
