import { z } from 'zod';
import {
  importDraftSchema,
  parseResultSchema,
  templateTypeSchema,
  type ImportDraft,
  type ParseResult,
} from '@canglin/shared';

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
/**
 * AI 单页识别的输出契约（v2）：每条物理行带名称单元格原文 rawText；不再要求每行写 reason（前端从不显示，白耗 token）。
 * 日期格式、空品名、数量×单价与金额不符由服务端校验后置空或提示，不让整页因格式问题失败。
 */
export const aiPageSchema = z.object({
  templateType: templateTypeSchema.nullable(),
  serialNumber: z.string().nullable(),
  department: z.string().nullable(),
  handler: z.string().nullable(),
  requestDate: z.string().nullable(),
  items: z
    .array(
      z.object({
        lineId: z.string().nullable(),
        rawText: z.string().trim().max(500),
        itemName: z.string().trim().max(200),
        spec: z.string().trim().max(200).nullable(),
        quantity: z.number().positive().nullable(),
        unit: z.string().trim().max(16).nullable(),
        unitPrice: z.number().nonnegative().nullable(),
        amount: z.number().nonnegative().nullable(),
        purchaseLink: z.string().trim().max(500).nullable(),
      }),
    )
    .max(100),
  warnings: z.array(z.string()).max(20),
});
export type AiPage = z.infer<typeof aiPageSchema> & { page: number };

/** 服务端校验 AI 单页结果（原地修改）：日期不合法置空、空品名的行丢弃、rawText 回填、数量×单价与金额不符提示 */
export function checkAiPage(parsed: z.infer<typeof aiPageSchema>) {
  const warnings: string[] = [];
  const date = parsed.requestDate;
  if (date && !(/^\d{4}-\d{2}-\d{2}$/.test(date) && new Date(`${date}T00:00:00Z`).toISOString().startsWith(date))) {
    warnings.push(`AI 返回的申请日期「${date}」不是有效的 YYYY-MM-DD，已置空，请对照原件`);
    parsed.requestDate = null;
  }
  parsed.items = parsed.items.filter((item, index) => {
    if (item.itemName) return true;
    warnings.push(`AI 第 ${index + 1} 行没有品名，已忽略，请对照原件核对是否漏行`);
    return false;
  });
  for (const item of parsed.items) {
    if (!item.rawText) item.rawText = item.itemName;
    if (item.quantity != null && item.unitPrice != null && item.amount != null
      && Math.abs(item.quantity * item.unitPrice - item.amount) > 0.01)
      warnings.push(`「${item.itemName}」数量×单价与金额不符，请对照原件`);
  }
  parsed.warnings.push(...warnings);
}

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
  if (part.templateType && (!result.templateType || result.templateType === 'GENERIC'))
    result.templateType = part.templateType;
  result.warnings.push(...part.warnings);
  result.pages = result.pages!.map((p) => p.page === page
    ? (part.pages?.find((p) => p.page === page) ?? { page, status: 'DONE', mode: part.mode })
    : p);
}
const FIELD_LABELS = { serialNumber: '流水号', department: '申领部门', handler: '经办人', requestDate: '申请日期' } as const;
/** 收尾（原地修改）：明细按页码排序、警告去重，并按各页模式汇总整份结果的 mode */
export function finishResult(result: ParseResult) {
  result.items.sort((a, b) => (a.source?.page ?? 0) - (b.source?.page ?? 0));
  // 单页结果各自提示缺失的单据头；整份结果里已由其他页补上的字段不再提示
  const found = new Set(
    Object.entries(FIELD_LABELS).filter(([field]) => result[field as keyof typeof FIELD_LABELS]).map(([, label]) => `未识别到${label}，请人工确认`),
  );
  result.warnings = [...new Set(result.warnings)].filter((w) => !found.has(w));
  const modes = new Set(result.pages?.map((page) => page.mode));
  if (modes.size > 1) result.mode = 'PDF_MIXED';
  else for (const mode of ['AI_IMAGE', 'IMAGE_OCR', 'PDF_TEXT', 'PDF_OCR'] as const)
    if (modes.has(mode)) result.mode = mode;
}
