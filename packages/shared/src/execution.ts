import { z } from 'zod';
import { moneyText, parseFixed } from './decimal.js';
import { workflowDateSchema, workflowDistributionSchema, workflowPriceSchema, workflowQuantitySchema, workflowReceiptSchema, workflowStockInSchema } from './workflow.js';
import { linkSchema } from './links.js';

const id = z.coerce.number().int().positive();
const version = z.number().int().nonnegative();
const note = z.string().trim().max(1000).default('');
export const executionMoneySchema = z.string().transform((v, ctx) => {
  try { const n = parseFixed(v, 2, '金额'); if (n < 0n) throw new Error('金额不能为负'); return moneyText(n); }
  catch (e) { ctx.addIssue({ code: 'custom', message: (e as Error).message }); return z.NEVER; }
});
const positiveMoney = executionMoneySchema.refine(v => parseFixed(v, 2) > 0n, '金额必须大于零');
export const executionQuerySchema = z.object({ search: z.string().trim().max(100).default(''), status: z.string().max(30).default(''), supplierId: id.optional(), documentId: id.optional(), page: id.default(1), pageSize: id.max(200).default(20), dateFrom: workflowDateSchema.optional(), dateTo: workflowDateSchema.optional() }).refine(q => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, '起始日期不能晚于结束日期');
export type ExecutionQuery = z.infer<typeof executionQuerySchema>;
export const executionReasonSchema = z.object({ version, reason: z.string().trim().min(1).max(500), date: workflowDateSchema }).strict();
export const batchCreateSchema = z.object({ title: z.string().trim().min(1).max(100), date: workflowDateSchema, note, requestLineIds: z.array(id).min(1).max(200).refine(ids => new Set(ids).size === ids.length, '需求明细不能重复') }).strict();
export const batchSaveSchema = z.object({ version, title: batchCreateSchema.shape.title, date: workflowDateSchema, note,
  lines: z.array(z.object({ requestLineId: id, quantity: workflowQuantitySchema, supplierId: id.nullable(), unitPrice: workflowPriceSchema.nullable(), purchaseLink: linkSchema.nullable() }).strict()).min(1).max(200),
}).strict();
export type BatchCreateInput = z.infer<typeof batchCreateSchema>;
export type BatchSaveInput = z.infer<typeof batchSaveSchema>;
export interface DemandRow { requestLineId: number; requestId: number; serialNumber: string; department: string; handler: string; requestDate: string; productId: number; itemName: string; specification: string; unit: string; remaining: string; purchaseLink: string | null; draftBatchIds: number[] }
export interface BatchRow { id: number; title: string; date: string; note: string; status: string; version: number; createdAt: string; cancelReason: string | null;
  lines: { id: number; requestLineId: number | null; requestId: number | null; requestSerial: string; department: string; itemName: string; specification: string; unit: string; quantity: string; remaining: string; supplierId: number | null; unitPrice: string | null; purchaseLink: string | null }[];
  documents: { id: number; supplierName: string | null; status: string; amount: string; pendingReceipt: { itemName: string; quantity: string; unit: string }[] }[];
}
const allocation = z.object({ documentId: id, amount: positiveMoney, version }).strict();
const allocations = z.array(allocation).min(1).max(200).refine(a => new Set(a.map(x => x.documentId)).size === a.length, '采购单不能重复');
export const financialCreateSchema = z.object({ kind: z.enum(['PAYMENT', 'REFUND', 'REIMBURSEMENT', 'REIMBURSEMENT_RETURN']), date: workflowDateSchema, supplierId: id, payer: z.enum(['COMPANY', 'EMPLOYEE']), employee: z.string().trim().max(64).default(''), sourceId: id.nullable().default(null), amount: positiveMoney, method: z.string().trim().max(100).default(''), reference: z.string().trim().max(100).default(''), note, allocations }).strict()
  .refine(v => v.payer !== 'EMPLOYEE' || !!v.employee, '请填写垫付员工')
  .refine(v => (v.kind === 'PAYMENT') === (v.sourceId === null), '退款和报销须选择原付款记录')
  .refine(v => v.allocations.reduce((n, a) => n + parseFixed(a.amount, 2), 0n) === parseFixed(v.amount, 2), '分配金额合计必须等于本次金额');
export type FinancialCreateInput = z.infer<typeof financialCreateSchema>;
export const openingSchema = z.object({ version, date: workflowDateSchema, note: z.string().trim().min(1).max(1000), payments: z.array(z.object({ payer: z.enum(['COMPANY', 'EMPLOYEE']), employee: z.string().trim().max(64).default(''), netPaid: executionMoneySchema, reimbursed: executionMoneySchema.default('0.00') }).strict().refine(p => p.payer === 'COMPANY' ? p.reimbursed === '0.00' : !!p.employee, '请核对垫付人与已报销金额').refine(p => parseFixed(p.netPaid, 2) > 0n || parseFixed(p.reimbursed, 2) > 0n, '均为零时无需添加此余额')).max(50) }).strict();
export type OpeningInput = z.infer<typeof openingSchema>;
export interface SettlementRow { documentId: number; date: string; supplierId: number; supplierName: string; mode: string; version: number; asOf: string | null; legacyPaymentStatus: string; legacyInvoiceIssued: boolean; netAmount: string; paid: string | null; refunded: string | null; netPaid: string | null; payable: string | null; refundDue: string | null; reimbursementDue: string | null; employeeReturnDue: string | null; invoiceAmount: string; invoiceMissing: string; invoiceExcess: string; requests: { id: number; serialNumber: string }[] }
export interface FinancialRow { settlementFrom?: string | null; settlementTo?: string | null; id: number; kind: string; status: string; date: string; supplierId: number; supplierName: string; payer: string; employee: string; amount: string; sourceId: number | null; reference: string; method: string; note: string; version: number; voidReason: string | null; openingReimbursed: string; refundable: string; reimbursable: string; returnable: string; allocations: { documentId: number; amount: string }[]; attachmentCount: number }
export const invoiceSchema = z.object({ supplierId: id, number: z.string().trim().min(1).max(100), date: workflowDateSchema, kind: z.enum(['NORMAL', 'CREDIT']).default('NORMAL'), originalId: id.nullable().default(null), amount: positiveMoney, note }).strict().refine(v => (v.kind === 'CREDIT') === (v.originalId !== null), '冲减票据须关联原发票');
export type InvoiceInput = z.infer<typeof invoiceSchema>;
export const invoiceAllocationSchema = z.object({ version, allocations: z.array(allocation).max(200).refine(a => new Set(a.map(x => x.documentId)).size === a.length, '采购单不能重复') }).strict();
export type InvoiceAllocationInput = z.infer<typeof invoiceAllocationSchema>;
export interface InvoiceRow { id: number; supplierId: number; supplierName: string; number: string; date: string; kind: string; originalId: number | null; amount: string; allocated: string; remaining: string; status: string; version: number; note: string; voidReason: string | null; attachmentCount: number; allocations: { documentId: number; amount: string }[] }
export const exceptionActionSchema = z.object({ key: z.string().min(1).max(100), version, action: z.enum(['SNOOZE', 'IGNORE', 'RESUME']), untilDate: workflowDateSchema.nullable().default(null), reason: z.string().trim().min(1).max(500) }).strict().refine(v => (v.action === 'SNOOZE' ? v.untilDate !== null : v.untilDate === null), '暂缓须填写日期，其他操作无需日期');
export type ExceptionActionInput = z.infer<typeof exceptionActionSchema>;
export interface ExceptionRow { key: string; type: string; title: string; detail: string; url: string; state: 'ACTIVE' | 'SNOOZED' | 'IGNORED' | 'RESOLVED'; version: number; reason: string; untilDate: string | null }
export const exceptionRulesSchema = z.object({ receivingDays: z.number().int().min(1).max(365), draftDays: z.number().int().min(1).max(365), stockIdleDays: z.number().int().min(1).max(730) }).strict();
export type ExceptionRules = z.infer<typeof exceptionRulesSchema>;
export const executionPayloadSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('PURCHASE_BATCH'), data: batchCreateSchema }).strict(),
  z.object({ kind: z.literal('RECEIPT'), data: workflowReceiptSchema }).strict(),
  z.object({ kind: z.literal('STOCK_IN'), data: workflowStockInSchema }).strict(),
  z.object({ kind: z.literal('DISTRIBUTION'), data: workflowDistributionSchema }).strict(),
  z.object({ kind: z.literal('INVOICE_MATCH'), data: invoiceAllocationSchema.extend({ invoiceId: id }) }).strict(),
]);
export type ExecutionPayload = z.infer<typeof executionPayloadSchema>;
export interface DraftContextRow { id: number; label: string; unit: string; available: string; source: string; url: string }
export const executionDraftSchema = z.object({ title: z.string().trim().min(1).max(100), action: executionPayloadSchema }).strict();
export interface ExecutionDraftRow { id: number; title: string; kind: string; source: string; status: string; version: number; action: ExecutionPayload; suggestion: ExecutionPayload | null; prompt: string | null; explanation: string | null; stale: boolean; result: unknown; createdAt: string; updatedAt: string }
export const aiProposalSchema = z.object({ kind: z.enum(['PURCHASE_BATCH', 'INVOICE_MATCH']), prompt: z.string().trim().min(1).max(2000), requestLineIds: z.array(id).max(200).default([]), invoiceId: id.optional(), documentIds: z.array(id).max(200).default([]) }).strict();
export type AiProposalInput = z.infer<typeof aiProposalSchema>;
export interface MonthlyReview { month: string; basis: string; procurement: { gross: string; cancelled: string; returned: string; net: string }; cash: { payments: string; refunds: string; reimbursements: string; reimbursementReturns: string }; legacyUnverified: number; supplierPerformance: { supplierId: number; supplierName: string; receivedLines: number; averageDays: number | null; overdueLines: number }[]; idleStock: { productId: number; itemName: string; unit: string; quantity: string }[]; recipients: { recipient: string; department: string; itemName: string; unit: string; issued: string; returned: string; net: string }[] }
