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

export const workflowRequestCreateSchema = z.object({
  serialNumber: z.string().trim().min(1).max(64),
  department: z.string().trim().min(1).max(64),
  handler: z.string().trim().min(1).max(64),
  requestDate: workflowDateSchema,
  note: noteSchema,
  sourceTaskId: z.string().trim().min(1).max(64).optional(),
  sourceAttachmentIds: z.array(idSchema).max(100).default([]),
  lines: z.array(z.object({
    itemName: z.string().trim().min(1).max(200),
    specification: z.string().trim().max(200).default(''),
    unit: z.string().trim().min(1, '请确认原件单位').max(16),
    quantity: workflowQuantitySchema,
    note: noteSchema,
    /** 申请里附的采购链接（OA 原件备注里的商城链接）；登记采购时预填 */
    purchaseLink: linkSchema.nullish(),
  })).min(1).max(500),
});
export type WorkflowRequestCreateInput = z.infer<typeof workflowRequestCreateSchema>;

export const workflowPurchaseSchema = z.object({
  date: workflowDateSchema,
  supplierId: idSchema,
  note: noteSchema,
  lines: z.array(z.object({
    requestLineId: idSchema,
    quantity: workflowQuantitySchema,
    unitPrice: workflowPriceSchema,
    purchaseLink: linkSchema.optional(),
  })).min(1).max(200),
});
export type WorkflowPurchaseInput = z.infer<typeof workflowPurchaseSchema>;

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

export const workflowQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  requestId: idSchema.optional(),
  productId: idSchema.optional(),
  supplierId: idSchema.optional(),
  kind: z.enum(WORKFLOW_DOCUMENT_KINDS).optional(),
  stage: z.enum(WORKFLOW_STAGES).optional(),
  pending: z.literal('1').optional(),
  dateFrom: workflowDateSchema.optional(),
  dateTo: workflowDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
}).refine((value) => !value.dateFrom || !value.dateTo || value.dateFrom <= value.dateTo, '起始日期不能晚于结束日期');
export type WorkflowQuery = z.infer<typeof workflowQuerySchema>;

export const workflowProductCreateSchema = workflowRequestCreateSchema.shape.lines.element.pick({ itemName: true, specification: true, unit: true });
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
  pendingPurchaseQuantity: string; pendingReceiptQuantity: string; pendingAllocationQuantity: string;
  directQuantity: string; stockedQuantity: string; issuedQuantity: string; stockQuantity: string;
  supplierReturnedQuantity: string; employeeReturnedQuantity: string;
  stages: WorkflowStage[];
}
export interface WorkflowRequestRow {
  id: number; serialNumber: string; department: string; handler: string; requestDate: string;
  note: string | null; sourceTaskId: string | null; createdAt: string;
  lines: WorkflowRequestLineRow[]; attachments: WorkflowAttachment[];
  /** 没有任何业务记录（采购、取消、到货…，含已撤销的单据）时可以删除 */
  deletable: boolean;
}
/** 物品库的一条（导入时沿用单位、给候选） */
export interface WorkflowProductRow { id: number; name: string; specification: string; unit: string }
export interface WorkflowDocumentLineRow {
  id: number; documentId: number; requestLineId: number | null; sourceLineId: number | null;
  requestId: number | null; serialNumber: string | null;
  productId: number; itemName: string; specification: string; unit: string;
  quantity: string; unitPrice: string | null; amount: string | null; purchaseLink: string | null;
  purchaseReductionAmount: string | null;
  recipient: string | null; location: WorkflowLocation | null; reason: string | null;
  receivedQuantity: string; remainingQuantity: string;
  sourceAllocations?: { originLineId: number; quantity: string; requestId: number | null; serialNumber: string | null }[];
}
export interface WorkflowDocumentRow {
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
  id: number; documentId: number; documentKind: WorkflowDocumentKind; date: string;
  businessLineId: number; originLineId: number; productId: number;
  itemName: string; specification: string; unit: string; location: WorkflowLocation;
  quantity: string; reversalOfId: number | null; createdAt: string;
}
export interface WorkflowOverview {
  requestCount: number; purchaseCount: number; receiptCount: number;
  pendingPurchaseLines: number; pendingReceiptLines: number; pendingAllocationLines: number;
  purchaseAmount: string; receiptAmount: string; productCount: number;
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
