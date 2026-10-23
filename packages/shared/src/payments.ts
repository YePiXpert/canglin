import { z } from 'zod';
import { PAYMENT_STATUSES, type PaymentStatus } from './enums.js';
import { workflowDateSchema } from './workflow.js';

const id = z.coerce.number().int().positive();
export const paymentQuerySchema = z.object({
  search: z.string().trim().max(100).optional(),
  supplierId: id.optional(),
  paymentStatus: z.enum(PAYMENT_STATUSES).optional(),
  invoiceIssued: z.enum(['0', '1']).optional(),
  hasInvoice: z.enum(['0', '1']).optional(),
  dateFrom: workflowDateSchema.optional(), dateTo: workflowDateSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(20),
}).refine((q) => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, '起始日期不能晚于结束日期');
export type PaymentQuery = z.infer<typeof paymentQuerySchema>;
export interface PaymentRow {
  id: number; date: string; supplierId: number | null; supplierName: string | null;
  totalAmount: string; paymentStatus: PaymentStatus; invoiceIssued: boolean; invoiceCount: number;
  requests: { id: number; serialNumber: string }[];
}
export interface PaymentSummary { unpaid: number; uninvoiced: number; missingInvoice: number }
export const paymentBatchSchema = z.object({
  documents: z.array(z.object({
    id, paymentStatus: z.enum(PAYMENT_STATUSES), invoiceIssued: z.boolean(),
  }).strict()).min(1).max(200)
    .refine((rows) => new Set(rows.map((r) => r.id)).size === rows.length, '采购单不能重复选择')
    .transform((rows) => [...rows].sort((a, b) => a.id - b.id)),
  change: z.union([
    z.object({ paymentStatus: z.enum(PAYMENT_STATUSES) }).strict(),
    z.object({ invoiceIssued: z.boolean() }).strict(),
  ]),
}).strict();
export type PaymentBatchInput = z.infer<typeof paymentBatchSchema>;
export interface PaymentBatchResult { updatedIds: number[]; unchangedIds: number[] }
