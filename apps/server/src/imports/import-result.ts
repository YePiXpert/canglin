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
export type AiPage = z.infer<typeof aiPageSchema> & { page: number; mode?: 'RECOGNITION' | 'REVIEW' };
/** AI 返回的内容不符合本次调用的约定（如审核模式增删了物理行）：按契约错误处理，该页回退本地结果 */
export class AiContractError extends Error {}
const HEADER_FIELDS = ['serialNumber', 'department', 'handler', 'requestDate'] as const;

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

/**
 * 审核模式（原地修改）：AI 必须逐条返回文本层的物理行（lineId 集合一致，不增删、不合并），按文本层的顺序排列；
 * 数量、单价、金额、链接与已有的单据头一律以文本层为准，模型读数不同只写提示。
 */
export function checkReview(page: number, parsed: z.infer<typeof aiPageSchema>, rows: ParseResult['items'], header: Partial<ParseResult>) {
  const ids = rows.map((row) => row.lineId);
  const got = parsed.items.map((item) => item.lineId);
  if (got.length !== ids.length || new Set(got).size !== got.length || got.some((id) => !id || !ids.includes(id)))
    throw new AiContractError('REVIEW_MISMATCH：AI 返回的行与文本层的物理行不一致');
  const warnings: string[] = [];
  parsed.items = rows.map((row, index) => {
    const item = parsed.items.find((candidate) => candidate.lineId === row.lineId)!;
    const label = `第 ${page} 页第 ${index + 1} 行`;
    for (const [field, name] of [['quantity', '数量'], ['unitPrice', '单价'], ['amount', '金额']] as const)
      if ((item[field] ?? null) !== (row[field] ?? null))
        warnings.push(`AI 读到${label}${name}为 ${item[field] ?? '空白'}，已保留文本层的 ${row[field] ?? '空白'}`);
    if ((item.purchaseLink ?? null) !== (row.purchaseLink ?? null))
      warnings.push(`AI 读到的${label}链接与文本层不同，已保留文本层的链接`);
    return { ...item, rawText: row.source?.rawText ?? item.rawText, quantity: row.quantity,
      unitPrice: row.unitPrice ?? null, amount: row.amount ?? null, purchaseLink: row.purchaseLink ?? null };
  });
  for (const field of HEADER_FIELDS) {
    const kept = header[field];
    if (!kept) continue;
    if (parsed[field] && parsed[field] !== kept)
      warnings.push(`AI 读到的${FIELD_LABELS[field]}为「${parsed[field]}」，已保留文本层的「${kept}」`);
    parsed[field] = kept;
  }
  parsed.warnings.push(...warnings);
}

/** 识别模式附带了文本层时（原地修改）：链接必须逐字出现在文本层里（去掉空白后比较），否则置空并提示，不猜测替换 */
export function checkLinks(parsed: z.infer<typeof aiPageSchema>, textLayer: string) {
  const flat = textLayer.replace(/\s+/g, '');
  for (const item of parsed.items) {
    if (!item.purchaseLink || flat.includes(item.purchaseLink.replace(/\s+/g, ''))) continue;
    parsed.warnings.push(`「${item.itemName}」的链接不在本页文本层中，已置空，请对照原件`);
    item.purchaseLink = null;
  }
}
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
  else for (const mode of ['AI_IMAGE', 'AI_REVIEW', 'IMAGE_OCR', 'PDF_TEXT', 'PDF_OCR'] as const)
    if (modes.has(mode)) result.mode = mode;
}
