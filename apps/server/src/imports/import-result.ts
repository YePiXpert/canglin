import { z } from 'zod';
import {
  importDraftSchema,
  parseResultSchema,
  type ImportDraft,
  type ParseResult,
} from '@procure-lite/shared';

/**
 * 导入识别结果（ParseResult）的纯函数与常量，不依赖 Nest / Prisma：
 * ImportsService（任务视图、崩溃恢复、确认校验）与 ImportRecognitionService（逐页识别）共用。
 */
export const EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.webp', '.bmp'];
export const MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
};
export const aiPageSchema = z.object({
  serialNumber: z.string().nullable(),
  department: z.string().nullable(),
  handler: z.string().nullable(),
  requestDate: z.string().nullable(),
  items: z
    .array(
      z.object({
        lineId: z.string().nullable(),
        itemName: z.string().trim(),
        spec: z.string().trim().max(200).nullable().default(null),
        quantity: z.number().positive().nullable(),
        unit: z.string().trim().max(16).nullable(),
        unitPrice: z.number().nonnegative().nullable(),
        purchaseLink: z.string().trim().max(500).nullable(),
        reason: z.string(),
      }),
    )
    .max(100),
  warnings: z.array(z.string()).max(20),
});
export type AiPage = z.infer<typeof aiPageSchema> & { page: number };

/** 解析库里保存的识别结果 JSON：旧数据缺少的 quantity / lineId 补为 null / legacy-序号，再按契约校验 */
export function normalizeResult(value: string | null): ParseResult | undefined {
  if (!value) return;
  const raw = JSON.parse(value);
  raw.items = (raw.items ?? []).map((it: Record<string, unknown>, index: number) => ({
    ...it,
    quantity: it.quantity ?? null,
    lineId: it.lineId ?? `legacy-${index}`,
    source: it.source,
  }));
  return parseResultSchema.parse(raw);
}
/** 由识别结果生成初始草稿：表头空值记为空串，尚无页面核对记录 */
export function draftFrom(result: ParseResult): ImportDraft {
  return importDraftSchema.parse({
    serialNumber: result.serialNumber ?? '',
    department: result.department ?? '',
    handler: result.handler ?? '',
    requestDate: result.requestDate ?? '',
    items: result.items,
    reviewedPages: [],
  });
}
/** 把单页识别结果并入整份结果（原地修改）：表头与已有值不一致只记警告，该页明细与页面状态整体替换 */
export function mergePage(result: ParseResult, page: number, part: ParseResult) {
  for (const field of ['serialNumber', 'department', 'handler', 'requestDate'] as const) {
    if (!part[field]) continue;
    if (result[field] && result[field] !== part[field])
      result.warnings.push(`第 ${page} 页${field}与其他页面不一致，请人工确认`);
    else result[field] = part[field];
  }
  result.items = [
    ...result.items.filter((item) => item.source?.page !== page),
    ...part.items.map((item) => ({ ...item, source: {
      ...item.source, page, method: item.source?.method ?? part.mode,
    } })),
  ];
  result.warnings.push(...part.warnings);
  result.pages = result.pages!.map((p) => p.page === page
    ? (part.pages?.find((p) => p.page === page) ?? { page, status: 'DONE', mode: part.mode })
    : p);
}
/** 收尾（原地修改）：明细按页码排序、警告去重，并按各页模式汇总整份结果的 mode */
export function finishResult(result: ParseResult) {
  result.items.sort((a, b) => (a.source?.page ?? 0) - (b.source?.page ?? 0));
  result.warnings = [...new Set(result.warnings)];
  const modes = new Set(result.pages?.map((page) => page.mode));
  if (modes.size > 1) result.mode = 'PDF_MIXED';
  else for (const mode of ['AI_IMAGE', 'IMAGE_OCR', 'PDF_TEXT', 'PDF_OCR'] as const)
    if (modes.has(mode)) result.mode = mode;
}
