import { z } from 'zod';
import { financialCreateSchema, type SettlementRow } from './execution.js';
import { parseFixed } from './decimal.js';
import { workflowDateSchema } from './workflow.js';

export const supplierSettlementSchema = z.object({
  supplierId: z.number().int().positive(), date: workflowDateSchema,
  dateFrom: workflowDateSchema.optional(), dateTo: workflowDateSchema.optional(),
  amount: financialCreateSchema.shape.amount,
  allocations: financialCreateSchema.shape.allocations,
  method: z.string().trim().max(100).default(''), reference: z.string().trim().max(100).default(''),
  note: z.string().trim().max(1000).default(''), confirmUnpaidLegacy: z.boolean().default(false),
}).strict().refine(v => !v.dateFrom || !v.dateTo || v.dateFrom <= v.dateTo, '起始日期不能晚于结束日期')
  .refine(v => v.allocations.reduce((sum, row) => sum + parseFixed(row.amount, 2), 0n) === parseFixed(v.amount, 2), '所选采购金额合计必须等于结算金额');
export type SupplierSettlementInput = z.infer<typeof supplierSettlementSchema>;
export interface SupplierStatementPurchase extends SettlementRow { originalAmount: string; deductionAmount: string }
export interface SupplierStatementRow {
  dateFrom: string | null; dateTo: string | null;
  supplierId: number; supplierName: string; purchaseCount: number;
  originalAmount: string; deductionAmount: string; netAmount: string;
  netPaid: string; payable: string; refundDue: string;
  legacyCount: number; legacyAmount: string;
  invoiceAmount: string; invoiceMissing: string; invoiceExcess: string;
  purchases: SupplierStatementPurchase[];
}
