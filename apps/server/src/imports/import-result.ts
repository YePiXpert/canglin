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
        /**
         * 原件没写单位时推测的单位（v3 / review-v2 起）：只用来填草稿，不参与「AI 建议待核对」的判断；
         * 旧响应与合成替身没有这个字段时按 null。长度与格式不合要求时由 checkAiPage 置空，不让整页失败。
         */
        unitGuess: z.string().nullable().default(null),
        /** 与已有物品明显是同一物品时，原样给出目录里的那一条；只是建议，界面由用户决定是否采用 */
        catalogSuggestion: z.object({ name: z.string(), spec: z.string().nullable(), unit: z.string().nullable() }).nullable(),
      }),
    )
    .max(100),
  warnings: z.array(z.string()).max(20),
});
export type CatalogEntry = { name: string; spec: string | null; unit: string | null };
export type AiPage = z.infer<typeof aiPageSchema> & { page: number; mode?: 'RECOGNITION' | 'REVIEW' };
/** AI 返回的内容不符合本次调用的约定（如审核模式增删了物理行）：按契约错误处理，该页回退本地结果 */
export class AiContractError extends Error {}
const HEADER_FIELDS = ['serialNumber', 'department', 'handler', 'requestDate'] as const;

/**
 * 推测单位只要一个短词：去掉空白；原件写了单位（unit 不为空）时不需要推测；带数字或超过 8 个字的不是单位。
 */
function cleanUnitGuess(item: { unit: string | null; unitGuess: string | null }) {
  const guess = item.unitGuess?.trim() ?? '';
  item.unitGuess = !item.unit && guess && guess.length <= 8 && !/\d/.test(guess) ? guess : null;
}

/** 服务端校验 AI 单页结果（原地修改）：日期不合法置空、推测单位清理；识别模式另外丢弃空品名的行、回填 rawText、提示数量×单价与金额不符 */
export function checkAiPage(parsed: z.infer<typeof aiPageSchema>, review = false) {
  const warnings: string[] = [];
  for (const item of parsed.items) cleanUnitGuess(item);
  const date = parsed.requestDate;
  const time = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T00:00:00Z`) : NaN;
  // 13 月、0 日等无法解析，2 月 30 日之类会顺延：两种都不是原件上的日期
  if (date && !(Number.isFinite(time) && new Date(time).toISOString().startsWith(date))) {
    warnings.push(`AI 返回的申请日期「${date}」不是有效的 YYYY-MM-DD，已置空，请对照原件`);
    parsed.requestDate = null;
  }
  if (review) {
    // 审核模式的行、品名原文与数字都由 checkReview 按文本层核对，这里只校验日期
    parsed.warnings.push(...warnings);
    return;
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
    const rawText = row.source?.rawText ?? item.rawText;
    return { ...item, rawText, itemName: item.itemName || rawText, spec: mergeSpecs(item.spec, row.spec),
      quantity: row.quantity, unitPrice: row.unitPrice ?? null, amount: row.amount ?? null, purchaseLink: row.purchaseLink ?? null };
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

/**
 * 审核模式的规格：模型从品名拆出的规格在前，文本层规格列（规格型号、主要技术指标、生产厂家）的内容一律保留在后，
 * 已经包含的片段不重复；超过 200 字截断。
 */
export function mergeSpecs(model: string | null | undefined, grid: string | null | undefined): string | null {
  const parts = (value: string | null | undefined) => (value ?? '').split('；').map((p) => p.trim()).filter(Boolean);
  const merged = parts(model);
  for (const part of parts(grid)) if (!merged.some((m) => m.includes(part) || part.includes(m))) merged.push(part);
  return merged.join('；').slice(0, 200) || null;
}

/** 品名归一建议（原地修改）：只接受与物品目录某一条完全相同的建议，其余置空 */
export function checkCatalog(parsed: z.infer<typeof aiPageSchema>, catalog: CatalogEntry[]) {
  const same = (a: string | null | undefined, b: string | null | undefined) => (a || null) === (b || null);
  for (const item of parsed.items) {
    const s = item.catalogSuggestion;
    if (s && !catalog.some((c) => c.name === s.name && same(c.spec, s.spec) && same(c.unit, s.unit)))
      item.catalogSuggestion = null;
  }
}

/**
 * 识别模式附带了文本层时（原地修改）：链接必须能由文本层里的片段按先后顺序拼出来，否则置空并提示，不猜测替换。
 * 备注格里按字符换行的链接，片段之间夹着同一行其他格的文字，所以按片段而不是整段文字比较。
 */
export function checkLinks(parsed: z.infer<typeof aiPageSchema>, textLayer: string) {
  const tokens = textLayer.split(/\s+/).filter(Boolean);
  const present = (link: string) => {
    const target = link.replace(/\s+/g, '');
    return tokens.some((first, i) => {
      if (!first.startsWith('http') || !target.startsWith(first)) return false;
      let rest = target.slice(first.length);
      // 同一格的续写总在下一条链接之前：遇到下一个链接开头就停，不把两条链接拼在一起
      for (let j = i + 1; rest && j < tokens.length && !tokens[j].startsWith('http'); j++)
        if (rest.startsWith(tokens[j]) && (tokens[j].length >= 4 || tokens[j] === rest)) rest = rest.slice(tokens[j].length);
      return !rest;
    });
  };
  for (const item of parsed.items) {
    if (!item.purchaseLink || present(item.purchaseLink)) continue;
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
  // 审核页的页模式是 AI_REVIEW；整份结果仍按 AI_IMAGE 汇总，回退到旧版本时旧契约也能读取
  const modes = new Set(result.pages?.map((page) => (page.mode === 'AI_REVIEW' ? 'AI_IMAGE' : page.mode)));
  if (modes.size > 1) result.mode = 'PDF_MIXED';
  else for (const mode of ['AI_IMAGE', 'IMAGE_OCR', 'PDF_TEXT', 'PDF_OCR'] as const)
    if (modes.has(mode)) result.mode = mode;
}
