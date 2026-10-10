/**
 * 前后端共用的契约：供应商、认证、OA 导入（识别结果、草稿、确认明细）、备份与 AI。
 * 申请、采购、到货与领用等业务单据契约在 workflow.ts，导入确认建单在 workflow-import.ts。
 */
import { z } from 'zod';

/** YYYY-MM-DD 本地日期字符串 */
const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD');

const positiveNumber = z.coerce.number().positive('必须大于 0');

/* --------------------------------- 供应商 --------------------------------- */

export const supplierUpsertSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  name: z.string().trim().min(1, '供应商名称不能为空').max(120, '供应商名称不超过 120 字'),
  contact: z.string().trim().max(64, '联系人不超过 64 字').optional(),
  phone: z.string().trim().max(32, '电话不超过 32 字').optional(),
  note: z.string().trim().max(500, '备注不超过 500 字').optional(),
});
export type SupplierUpsertInput = z.infer<typeof supplierUpsertSchema>;

/* ---------------------------------- 认证 ---------------------------------- */

export const setupSchema = z.object({
  password: z.string().min(8, '密码至少 8 位').max(128),
});
export const loginSchema = z.object({
  password: z.string().min(1, '请输入密码').max(128),
});
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8, '新密码至少 8 位').max(128),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    message: '新密码不能与当前密码相同',
  });

/* --------------------------------- OA 导入 --------------------------------- */

/**
 * 草稿保留未知字段（品名可为空、数量可缺失）；
 * 确认入账使用独立的严格契约（workflow-import.ts 的 workflowImportConfirmSchema）。
 */
export const sourceSchema = z.object({
  page: z.number().int().positive(),
  method: z.string(),
  rawText: z.string().optional(),
  box: z.array(z.array(z.number().min(0).max(1)).length(2)).nullish(),
  confidence: z.number().min(0).max(1).nullish(),
  rotation: z.number().optional(),
});
export const parsedItemSchema = z.object({
  lineId: z.string().optional(),
  itemName: z.string().trim(),
  spec: z.string().trim().max(200).nullish(),
  quantity: z.number().finite().nullable(),
  unit: z.string().max(16).nullish(),
  unitPrice: z.number().finite().nonnegative().nullish(),
  purchaseLink: z.string().trim().max(500).nullish(),
  source: sourceSchema.optional(),
});
export const parsePageSchema = z.object({
  page: z.number().int().positive(),
  status: z.enum(['PENDING', 'RUNNING', 'DONE', 'FAILED']),
  mode: z.string(),
  error: z.string().optional(),
});
export const parseResultSchema = z.object({
  schemaVersion: z.literal(2).optional(),
  parserVersion: z.string().optional(),
  serialNumber: z.string().optional(),
  department: z.string().optional(),
  handler: z.string().optional(),
  requestDate: z.string().optional(),
  items: z.array(parsedItemSchema),
  warnings: z.array(z.string()),
  pages: z.array(parsePageSchema).optional(),
  pageCount: z.number().int().positive().optional(),
  mode: z.enum(['PDF_TEXT', 'PDF_OCR', 'IMAGE_OCR', 'PDF_MIXED', 'TEXT', 'AI_IMAGE']),
});
export type ParseResult = z.infer<typeof parseResultSchema>;
/** 确认导入的明细只记申请事实（品名、规格、数量、单位）；成交价与链接在登记采购时填写。 */
export const confirmedItemSchema = z.object({
  lineId: z.string().optional(),
  itemName: z.string().trim().min(1).max(200),
  spec: z.string().trim().max(200).nullish(),
  quantity: positiveNumber,
  unit: z.string().trim().max(16).nullish(),
});
export const importDraftSchema = z.object({
  serialNumber: z.string().default(''),
  department: z.string().default(''),
  handler: z.string().default(''),
  requestDate: z.string().default(''),
  items: z.array(parsedItemSchema).max(500),
  reviewedPages: z
    .array(z.object({ page: z.number().int().positive(), note: z.string().trim().min(1).max(500) }))
    .default([]),
  reviewedAi: z.array(z.string().max(4000)).max(500).default([]),
});
/** Binds a human decision to the exact proposal; a changed retry must be reviewed again. */
export function aiSuggestionKey(item: {
  lineId: string | null;
  itemName: string;
  spec?: string | null;
  quantity: number | null;
  unit?: string | null;
  unitPrice?: number | null;
  purchaseLink?: string | null;
}): string {
  const fields: (string | number | null)[] = [
    item.lineId,
    item.itemName,
    item.quantity,
    item.unit ?? null,
    item.unitPrice ?? null,
    item.purchaseLink ?? null,
  ];
  // Existing decisions without a specification retain their original fingerprint.
  if (item.spec != null) fields.push(item.spec);
  return JSON.stringify(fields);
}
export type ImportDraft = z.infer<typeof importDraftSchema>;
export const saveImportDraftSchema = z.object({
  version: z.number().int().nonnegative(),
  draft: importDraftSchema,
});

/* ---------------------------------- 备份 ---------------------------------- */

export const autoBackupConfigSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.coerce.number().int().min(1).max(720),
  keepCount: z.coerce.number().int().min(1).max(100),
});
export type AutoBackupConfig = z.infer<typeof autoBackupConfigSchema>;

/* ----------------------------------- AI ----------------------------------- */

/** OpenAI 兼容 LLM 服务配置（存 Setting 表，设置页可随时改） */
export const aiConfigSchema = z.object({
  enabled: z.boolean(),
  /** 如 https://open.bigmodel.cn/api/paas/v4 */
  baseUrl: z.string().trim().url('接口地址应为合法 URL').max(200),
  /** 留空 = 保留已保存的 Key */
  apiKey: z.string().trim().max(200).optional(),
  model: z.string().trim().min(1, '模型名不能为空').max(100),
  /** 申请单、单据与库存按品名搜索时启用 AI 同义词扩展（关闭则退回普通关键字匹配） */
  semanticSearch: z.boolean(),
  protocol: z.literal('responses').optional(),
  autoImport: z.boolean().optional(),
  inputPrice: z.number().nonnegative().nullish(),
  outputPrice: z.number().nonnegative().nullish(),
  monthlyBudget: z.number().positive().nullish(),
});
export type AiConfigInput = z.infer<typeof aiConfigSchema>;

/** GET 返回的配置视图：不回传 apiKey 明文 */
export interface AiConfigView {
  enabled: boolean;
  baseUrl: string;
  model: string;
  semanticSearch: boolean;
  apiKeySet: boolean;
  protocol?: 'responses';
  autoImport?: boolean;
  inputPrice?: number | null;
  outputPrice?: number | null;
  monthlyBudget?: number | null;
  capabilities?: {
    checkedAt: string;
    text: boolean;
    image: boolean;
    structured: boolean;
    tools: boolean;
  };
  keySource?: 'server' | 'database';
}

export const aiAskSchema = z.object({
  question: z.string().trim().min(1, '问题不能为空').max(500),
  /** 近几轮对话（不含本次问题），服务端拼接为上下文 */
  history: z
    .array(
      z.object({
        role: z.enum(['user', 'assistant']),
        content: z.string().max(4000),
      }),
    )
    .max(10)
    .optional(),
});
export type AiAskInput = z.infer<typeof aiAskSchema>;

/** 问答过程中的一次工具调用记录（前端折叠展示） */
export interface AiToolStep {
  name: string;
  args: Record<string, unknown>;
  count: number;
}

export interface AiAskResponse {
  answer: string;
  steps: AiToolStep[];
  model: string;
}

export const aiOcrReviewSchema = z.object({
  taskId: z.string().trim().min(1).max(64),
});
export type AiOcrReviewInput = z.infer<typeof aiOcrReviewSchema>;

/** OCR 校对建议：只包含与当前值不同的字段，前端逐项应用 */
export const aiOcrReviewResultSchema = z.object({
  serialNumber: z.string().optional(),
  department: z.string().optional(),
  handler: z.string().optional(),
  requestDate: dateString.optional(),
  lines: z
    .array(
      z.object({
        index: z.number().int().min(0).optional(),
        lineId: z.string(),
        itemName: z.string().optional(),
        quantity: z.number().positive().optional(),
        unitPrice: z.number().nonnegative().optional(),
        reason: z.string().max(200).optional(),
      }),
    )
    .max(100),
  warnings: z.array(z.string()).max(20),
});
export type AiOcrReviewResult = z.infer<typeof aiOcrReviewResultSchema>;
