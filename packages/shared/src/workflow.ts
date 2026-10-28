import { z } from 'zod';
import { quantityUnits, quantityText, priceUnits, priceText } from './decimal.js';
import { PAYMENT_STATUSES } from './enums.js';
import { linkSchema } from './links.js';

/** A real Gregorian date, without timezone conversion or JS date rollover. */
export const workflowDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式应为 YYYY-MM-DD').refine((value) => {
  const [year, month, day] = value.split('-').map(Number);
  if (year < 1 || month < 1 || month > 12 || day < 1) return false;
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}, '日期不存在');

export const workflowQuantitySchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    const units = quantityUnits(value);
    if (units <= 0n) throw new Error('数量必须大于 0');
    return quantityText(units);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '数量无效' });
    return z.NEVER;
  }
});
export const workflowPriceSchema = z.union([z.string(), z.number()]).transform((value, ctx) => {
  try {
    const units = priceUnits(value);
    if (units < 0n) throw new Error('单价不能为负数');
    return priceText(units);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '单价无效' });
    return z.NEVER;
  }
});
const idSchema = z.coerce.number().int().positive();
const noteSchema = z.string().trim().max(1000).optional();

export const WORKFLOW_DOCUMENT_KINDS = [
  'PURCHASE', 'RECEIPT', 'STOCK_IN', 'DISTRIBUTION', 'SUPPLIER_RETURN',
  'EMPLOYEE_RETURN', 'PURCHASE_CANCEL', 'REQUEST_CANCEL', 'ADJUSTMENT',
] as const;
export type WorkflowDocumentKind = typeof WORKFLOW_DOCUMENT_KINDS[number];
export const WORKFLOW_STAGES = ['PENDING_PURCHASE', 'PENDING_ARRIVAL', 'PENDING_DISTRIBUTION', 'COMPLETED', 'CANCELLED'] as const;
export type WorkflowStage = typeof WORKFLOW_STAGES[number];
export type WorkflowLocation = 'RECEIVING' | 'STOCK';

/**
 * 没有 OA 单号的申请（打过招呼先采购）由系统编号：「无OA-申请日期-当天序号」，如 无OA-20261016-01
 * （docs/manual-entry-2026-10.md N2）。前缀之后的部分只由服务端生成。
 */
export const AUTO_SERIAL_PREFIX = '无OA-';
/** 某个申请日期的系统编号前缀：无OA-20261016- */
export function autoSerialPrefix(requestDate: string): string {
  return `${AUTO_SERIAL_PREFIX}${requestDate.replaceAll('-', '')}-`;
}

const requestLineSchema = z.object({
  itemName: z.string().trim().min(1).max(200),
  specification: z.string().trim().max(200).default(''),
  unit: z.string().trim().min(1, '请确认原件单位').max(16),
  quantity: workflowQuantitySchema,
  note: noteSchema,
  /** 申请里附的采购链接（OA 原件备注里的商城链接）；登记采购时预填 */
  purchaseLink: linkSchema.nullish(),
});

/**
 * 单据头的流水号：autoSerial = 没有 OA 单号，流水号由系统编、必须空着；否则必须填 OA 流水号。
 * 人工录入与「修改申请信息」共用（docs/manual-entry-2026-10.md N1、N5）。
 */
const serialFields = {
  serialNumber: z.string().trim().max(64).default(''),
  autoSerial: z.boolean().default(false),
};
function checkSerial(value: { serialNumber: string; autoSerial: boolean }, ctx: z.RefinementCtx) {
  if (value.autoSerial && value.serialNumber)
    ctx.addIssue({ code: 'custom', path: ['serialNumber'], message: '勾了「没有 OA 单号」时流水号由系统编，不用填' });
  if (!value.autoSerial && !value.serialNumber)
    ctx.addIssue({ code: 'custom', path: ['serialNumber'], message: '请填写 OA 流水号；没有 OA 单号请勾选「没有 OA 单号」' });
}
const headerFields = {
  ...serialFields,
  department: z.string().trim().min(1).max(64),
  handler: z.string().trim().min(1).max(64),
  requestDate: workflowDateSchema,
  note: noteSchema,
};

export const workflowRequestCreateSchema = z.object({
  ...headerFields,
  sourceTaskId: z.string().trim().min(1).max(64).optional(),
  sourceAttachmentIds: z.array(idSchema).max(100).default([]),
  lines: z.array(requestLineSchema).min(1).max(500),
}).superRefine(checkSerial);
export type WorkflowRequestCreateInput = z.input<typeof workflowRequestCreateSchema>;

/**
 * 修改申请信息（N5）：单据头整份提交。补填 OA 流水号 = autoSerial false + 流水号；
 * autoSerial true = 换回这张申请的系统编号（以前没有就新编一个）。明细不在这里改。
 */
export const workflowRequestUpdateSchema = z.object(headerFields).superRefine(checkSerial);
export type WorkflowRequestUpdateInput = z.input<typeof workflowRequestUpdateSchema>;

const purchaseLineFields = {
  requestLineId: idSchema,
  quantity: workflowQuantitySchema,
  /** 本次超出待采购量的备货数量；不占用申请数量，实际收货后再入库。 */
  overPurchaseQuantity: workflowQuantitySchema.optional(),
  unitPrice: workflowPriceSchema,
  purchaseLink: linkSchema.optional(),
};
const validSurplus = (line: { quantity: string; overPurchaseQuantity?: string }) => !line.overPurchaseQuantity || quantityUnits(line.overPurchaseQuantity) <= quantityUnits(line.quantity);
export const workflowPurchaseSchema = z.object({
  settlementMode: z.enum(['LEGACY', 'DETAIL']).optional(),
  date: workflowDateSchema,
  supplierId: idSchema,
  note: noteSchema,
  lines: z.array(z.object(purchaseLineFields).refine(validSurplus, '多购数量不能超过本次采购数量')).min(1).max(200),
});
export type WorkflowPurchaseInput = z.infer<typeof workflowPurchaseSchema>;

/** 一次登记多家供应商，全部明细一起提交，按供应商生成独立采购记录。 */
export const workflowPurchaseRegistrationSchema = z.object({
  settlementMode: z.enum(['LEGACY', 'DETAIL']).optional(),
  date: workflowDateSchema,
  note: noteSchema,
  lines: z.array(z.object({ ...purchaseLineFields, supplierId: idSchema }).refine(validSurplus, '多购数量不能超过本次采购数量')).min(1).max(200)
    .refine(lines => new Set(lines.map(line => line.requestLineId)).size === lines.length, '一次登记中每条申请明细只能出现一次'),
});
export type WorkflowPurchaseRegistrationInput = z.infer<typeof workflowPurchaseRegistrationSchema>;
export interface WorkflowPurchaseRegistrationResult { documents: WorkflowDocumentRow[] }

/** 原采购明细原位纠错，保留单据与明细编号；版本和多购数量均由服务端重新核对。
 *  备注（note）与各行链接（purchaseLink）不参与版本：不提交表示保留原值，null 表示去掉链接。 */
export const workflowPurchaseUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  date: workflowDateSchema,
  supplierId: idSchema,
  note: noteSchema,
  reason: z.string().trim().min(1, '请填写修改原因').max(500),
  lines: z.array(z.object({
    id: idSchema,
    quantity: workflowQuantitySchema,
    overPurchaseQuantity: workflowQuantitySchema.optional(),
    unitPrice: workflowPriceSchema,
    purchaseLink: linkSchema.nullish(),
  }).refine(line => !line.overPurchaseQuantity || quantityUnits(line.overPurchaseQuantity) <= quantityUnits(line.quantity), '多购数量不能超过采购数量')).min(1).max(200),
});
export type WorkflowPurchaseUpdateInput = z.infer<typeof workflowPurchaseUpdateSchema>;

/** 更换申请明细或采购明细的链接；null / 空串表示去掉链接 */
export const workflowLinkUpdateSchema = z.object({ purchaseLink: linkSchema.nullable() });
export type WorkflowLinkUpdateInput = z.infer<typeof workflowLinkUpdateSchema>;

export const workflowReceiptSchema = z.object({
  date: workflowDateSchema,
  note: noteSchema,
  lines: z.array(z.object({
    purchaseLineId: idSchema,
    quantity: workflowQuantitySchema,
  })).min(1).max(200),
});
export type WorkflowReceiptInput = z.infer<typeof workflowReceiptSchema>;

/** 更正原到货总量；保留到货日期和来源，本次差额按更正日期追加流水。 */
export const workflowReceiptUpdateSchema = z.object({
  version: z.number().int().nonnegative(),
  date: workflowDateSchema,
  reason: z.string().trim().min(1, '请填写更正原因').max(500),
  note: noteSchema,
  lines: z.array(z.object({ id: idSchema, quantity: workflowQuantitySchema })).min(1).max(200),
});
export type WorkflowReceiptUpdateInput = z.infer<typeof workflowReceiptUpdateSchema>;

export const workflowQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  requestId: idSchema.optional(),
  productId: idSchema.optional(),
  supplierId: idSchema.optional(),
  kind: z.enum(WORKFLOW_DOCUMENT_KINDS).optional(),
  stage: z.enum(WORKFLOW_STAGES).optional(),
  pending: z.literal('1').optional(),
  /** 流水号精确匹配（录入时提醒流水号重复，N6） */
  serial: z.string().trim().min(1).max(64).optional(),
  /** 只要还没有 OA 单号的申请（流水号是系统编号，N7） */
  autoSerial: z.literal('1').optional(),
  dateFrom: workflowDateSchema.optional(),
  dateTo: workflowDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, '起始日期不能晚于结束日期');
export type WorkflowQuery = z.infer<typeof workflowQuerySchema>;

export const workflowProductCreateSchema = requestLineSchema.pick({ itemName: true, specification: true, unit: true });
export const workflowProductUpdateSchema = workflowProductCreateSchema.omit({ unit: true }).extend({
  version: z.number().int().nonnegative(),
  reason: z.string().trim().min(1, '请填写修改原因').max(500),
}).strict();
export type WorkflowProductUpdateInput = z.infer<typeof workflowProductUpdateSchema>;
export type WorkflowProductCreateInput = z.infer<typeof workflowProductCreateSchema>;
export const workflowStockInSchema = z.object({
  date: workflowDateSchema, note: noteSchema,
  lines: z.array(z.object({ receiptLineId: idSchema, quantity: workflowQuantitySchema })).min(1).max(200),
});
export type WorkflowStockInInput = z.infer<typeof workflowStockInSchema>;
export const workflowDistributionSchema = z.object({
  date: workflowDateSchema, source: z.enum(['DIRECT', 'STOCK']),
  department: z.string().trim().max(64).optional(), note: noteSchema,
  lines: z.array(z.object({
    receiptLineId: idSchema.optional(), productId: idSchema.optional(),
    recipient: z.string().trim().min(1).max(64), quantity: workflowQuantitySchema,
  })).min(1).max(200),
}).superRefine((value, ctx) => {
  value.lines.forEach((line, index) => {
    if (value.source === 'DIRECT' ? !line.receiptLineId || !!line.productId : !line.productId || !!line.receiptLineId)
      ctx.addIssue({ code: 'custom', path: ['lines', index], message: value.source === 'DIRECT' ? '直发必须且只能关联收货明细' : '库存领用必须且只能关联库存物品' });
  });
});
export type WorkflowDistributionInput = z.infer<typeof workflowDistributionSchema>;
const reasonSchema = z.string().trim().min(1, '请填写原因').max(1000);
export const workflowSupplierReturnSchema = z.object({
  date: workflowDateSchema, reason: reasonSchema, returnMode: z.enum(['REFUND', 'REPLACEMENT']),
  lines: z.array(z.object({ receiptLineId: idSchema, quantity: workflowQuantitySchema, location: z.enum(['RECEIVING', 'STOCK']) })).min(1).max(200),
});
export type WorkflowSupplierReturnInput = z.infer<typeof workflowSupplierReturnSchema>;
export const workflowEmployeeReturnSchema = z.object({
  date: workflowDateSchema, reason: reasonSchema,
  lines: z.array(z.object({ distributionLineId: idSchema, quantity: workflowQuantitySchema })).min(1).max(200),
});
export type WorkflowEmployeeReturnInput = z.infer<typeof workflowEmployeeReturnSchema>;
export const workflowPurchaseCancelSchema = z.object({
  date: workflowDateSchema, reason: reasonSchema,
  lines: z.array(z.object({ purchaseLineId: idSchema, quantity: workflowQuantitySchema })).min(1).max(200),
});
export type WorkflowPurchaseCancelInput = z.infer<typeof workflowPurchaseCancelSchema>;
export const workflowRequestCancelSchema = z.object({
  date: workflowDateSchema, reason: reasonSchema,
  lines: z.array(z.object({ requestLineId: idSchema, quantity: workflowQuantitySchema })).min(1).max(200),
});
export type WorkflowRequestCancelInput = z.infer<typeof workflowRequestCancelSchema>;
export const workflowAdjustmentSchema = z.object({
  date: workflowDateSchema, reason: reasonSchema, productId: idSchema,
  quantity: z.union([z.string(), z.number()]).transform((value, ctx) => {
    try {
      const units = quantityUnits(value);
      if (units === 0n) throw new Error('调整数量不能为零');
      return quantityText(units);
    } catch (error) {
      ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : '数量无效' });
      return z.NEVER;
    }
  }),
});
export type WorkflowAdjustmentInput = z.infer<typeof workflowAdjustmentSchema>;
export const workflowVoidSchema = z.object({ date: workflowDateSchema, reason: reasonSchema });
export type WorkflowVoidInput = z.infer<typeof workflowVoidSchema>;
export const workflowMetadataSchema = z.object({ paymentStatus: z.enum(PAYMENT_STATUSES).optional(), invoiceIssued: z.boolean().optional(), note: noteSchema }).strict();
export type WorkflowMetadataInput = z.infer<typeof workflowMetadataSchema>;

export interface WorkflowPage<T> { items: T[]; total: number; page: number; pageSize: number }
export interface WorkflowAttachment { id: number; kind: string; filename: string }
export interface WorkflowRequestLineRow {
  id: number; requestId: number; lineNumber: number; productId: number;
  itemName: string; specification: string; unit: string; quantity: string; note: string | null;
  /** 申请里附的采购链接（已精简）；没有为 null */
  purchaseLink: string | null;
  cancelledQuantity: string; orderedQuantity: string; receivedQuantity: string;
  /** 有效采购中超出申请需求的部分，尚未收货时不计入库存。 */
  overPurchasedQuantity?: string;
  pendingPurchaseQuantity: string; pendingReceiptQuantity: string; pendingAllocationQuantity: string;
  directQuantity: string; stockedQuantity: string; issuedQuantity: string; stockQuantity: string;
  supplierReturnedQuantity: string; employeeReturnedQuantity: string;
  stages: WorkflowStage[];
}
export interface WorkflowRequestRow {
  purpose?: 'STOCK_REPLENISHMENT';
  id: number; serialNumber: string; department: string; handler: string; requestDate: string;
  /** 系统编号（没有 OA 单号时编的「无OA-…」）：补填 OA 流水号后也保留，按它照样搜得到；从没编过为 null */
  systemSerial: string | null;
  /** 还没有 OA 单号：流水号就是系统编号 */
  autoSerial: boolean;
  note: string | null; sourceTaskId: string | null; createdAt: string;
  lines: WorkflowRequestLineRow[]; attachments: WorkflowAttachment[];
  /** 没有任何业务记录（采购、取消、到货…，含已撤销的单据）时可以删除 */
  deletable: boolean;
}
/** 物品库的一条（导入时沿用单位、给候选） */
export interface WorkflowProductRow { id: number; name: string; specification: string; unit: string }
export interface WorkflowProductDetailsRow extends WorkflowProductRow { version: number; aliases: { name: string; specification: string }[] }
/**
 * 部门与人员的候选（docs/manual-entry-2026-10.md P1）：从已有申请的部门 / 经办人与未撤销发放单的领用部门 / 领用人汇总，
 * 最近一次使用的在前、其次按次数。people 按「人 + 部门」分开（同名的人在两个部门各一条）；department 可能为空串（发放时没填部门）。
 * recent 是最近录入的申请里的「部门 · 经办人」，去重后最多 4 组。
 */
export interface WorkflowDirectory {
  departments: { name: string; uses: number; lastDate: string }[];
  people: { name: string; department: string; uses: number; lastDate: string }[];
  recent: { department: string; handler: string }[];
}
export interface WorkflowDocumentLineRow {
  id: number; documentId: number; requestLineId: number | null; sourceLineId: number | null;
  requestId: number | null; serialNumber: string | null;
  productId: number; itemName: string; specification: string; unit: string;
  quantity: string; unitPrice: string | null; amount: string | null; purchaseLink: string | null;
  /** 本采购行当前仍有效的多购部分。 */
  overPurchaseQuantity?: string;
  /** 修改采购时，同一申请明细可重新分配的需求总量（含本单原来占用的数量）。 */
  purchaseAvailableQuantity?: string;
  /** 已入库、直发或退货等已处理总量，更正后的到货量不能低于此值。 */
  receiptMinQuantity?: string;
  /** 同一采购明细在本到货单中可重新分配的总量，含采购尚待到货量。 */
  receiptPurchaseCapacity?: string;
  purchaseReductionAmount: string | null;
  recipient: string | null; location: WorkflowLocation | null; reason: string | null;
  receivedQuantity: string; remainingQuantity: string;
  sourceAllocations?: { originLineId: number; quantity: string; requestId: number | null; serialNumber: string | null }[];
}
export interface WorkflowDocumentRow {
  receiptVersion?: number;
  purchaseVersion?: number;
  purchaseEditReason?: string | null;
  /** 由集中采购批次确认生成的采购单；批次只保留原安排，修改采购单不回写批次。 */
  procurementBatchId?: number;
  settlement?: import('./execution.js').SettlementRow;
  invoiceManaged?: boolean;
  settlementMode?: 'LEGACY' | 'DETAIL';
  stocktakeId?: number;
  id: number; kind: WorkflowDocumentKind; date: string; status: 'POSTED' | 'VOIDED';
  supplierId: number | null; supplierName: string | null; department: string | null;
  source: 'DIRECT' | 'STOCK' | null; returnMode: 'REFUND' | 'REPLACEMENT' | null;
  note: string | null; totalAmount: string | null;
  paymentStatus: typeof PAYMENT_STATUSES[number]; invoiceIssued: boolean;
  voidReason: string | null; voidDate: string | null; createdAt: string; lines: WorkflowDocumentLineRow[];
  attachments: WorkflowAttachment[];
}
export interface WorkflowStockSourceRow {
  originLineId: number; receiptLineId: number | null; requestLineId: number | null;
  requestId: number | null; serialNumber: string | null;
  supplierName: string | null; unitPrice: string | null;
  receivingQuantity: string; stockQuantity: string;
}
export interface WorkflowStockRow {
  productId: number; itemName: string; specification: string; unit: string;
  receivingQuantity: string; stockQuantity: string; sources: WorkflowStockSourceRow[];
}
export interface WorkflowStockEntryRow {
  correctionReason?: string;
  id: number; documentId: number; documentKind: WorkflowDocumentKind; date: string;
  businessLineId: number; originLineId: number; productId: number;
  itemName: string; specification: string; unit: string; location: WorkflowLocation;
  quantity: string; reversalOfId: number | null; createdAt: string;
}
export interface WorkflowOverview {
  requestCount: number; purchaseCount: number; receiptCount: number;
  pendingPurchaseLines: number; pendingReceiptLines: number; pendingAllocationLines: number;
  purchaseAmount: string; receiptAmount: string;
  /** 有库存（当前库存大于 0）的物品种数；库存为 0 的、申请带进来还没入库的物品不算 */
  stockProductCount: number;
}
export interface WorkflowReport {
  grossPurchaseAmount: string; cancelledPurchaseAmount: string; refundedPurchaseAmount: string;
  netPurchaseAmount: string; grossReceiptAmount: string; supplierReturnAmount: string; netReceiptAmount: string;
  groups: { label: string; grossPurchaseAmount: string; cancelledPurchaseAmount: string; refundedPurchaseAmount: string; netPurchaseAmount: string; purchaseCount: number }[];
  recipients: { recipient: string; department: string; productId: number; itemName: string; specification: string; unit: string; quantity: string; returnedQuantity: string; netQuantity: string; times: number }[];
}
export interface WorkflowPriceRow {
  productId: number; itemName: string; specification: string; unit: string;
  supplierId: number; supplierName: string; unitPrice: string; purchaseLink: string | null;
  date: string; purchaseLineId: number;
}
