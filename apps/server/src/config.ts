import path from 'node:path';
import fs from 'node:fs';
import type { AiModelOption } from '@canglin/shared';

/** 运行时状态目录：数据库、上传、备份、密钥都集中在这里，便于挂载与备份 */
function resolveDataDir(): string {
  const dir = process.env.DATA_DIR
    ? path.resolve(process.env.DATA_DIR)
    : path.resolve(process.cwd(), 'state');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const dataDir = resolveDataDir();

/**
 * LLM_ALLOWED_MODELS：逗号分隔的模型名，限定设置页可选的模型；未设置（compose 传空串）、只有分隔符或 `*` 都不限制（null），
 * 模型从服务商接口获取后自选。去空格、去空项、去重，用 id 当显示名。
 */
export function parseAllowedModels(raw: string | undefined): AiModelOption[] | null {
  const value = raw?.trim();
  if (!value || value === '*') return null;
  const ids = [...new Set(value.split(',').map((id) => id.trim()).filter(Boolean))];
  return ids.length ? ids.map((id) => ({ id, label: id })) : null;
}

export const config = {
  dataDir,
  dbPath: path.join(dataDir, 'canglin.db'),
  uploadsDir: path.join(dataDir, 'uploads'),
  backupsDir: path.join(dataDir, 'backups'),
  secretPath: path.join(dataDir, 'session-secret'),
  databaseUrl: `file:${path.join(dataDir, 'canglin.db').replace(/\\/g, '/')}`,
  port: Number(process.env.PORT ?? 3000),
  ocrBaseUrl: process.env.OCR_BASE_URL ?? 'http://127.0.0.1:8000',
  ocrApiKey: process.env.OCR_API_KEY ?? 'dev-ocr-key',
  /** AI 能力的初始默认值；运行时以 Setting 表中的 aiConfig 为准（设置页可改）。用 || 是因为 compose 会把未设置的环境变量传成空串 */
  llmDefaults: {
    baseUrl: process.env.LLM_BASE_URL || 'https://api.openai.com/v1',
    apiKey: process.env.LLM_API_KEY_FILE
      ? fs.readFileSync(process.env.LLM_API_KEY_FILE, 'utf8').trim()
      : process.env.LLM_API_KEY || '',
    model: process.env.LLM_MODEL || 'gpt-6.1-sol',
  },
  /** 设置页可选的模型：LLM_ALLOWED_MODELS 逗号分隔；未设置或 `*` 为不限制（null），模型从服务商接口获取后自选 */
  llmAllowedModels: parseAllowedModels(process.env.LLM_ALLOWED_MODELS),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_MB ?? 30) * 1024 * 1024,
  /** AI_IMAGE_STRIPS=1：长截图按空白带切成最多 3 段、作为同一页的多张图识别（评测通过前默认关闭） */
  aiImageStrips: process.env.AI_IMAGE_STRIPS === '1',
  session: {
    cookieName: 'pl_session',
    ttlSeconds: 30 * 60,
    maxFailedAttempts: 5,
    lockMinutes: 15,
  },
} as const;

for (const dir of [config.uploadsDir, config.backupsDir]) {
  fs.mkdirSync(dir, { recursive: true });
}
