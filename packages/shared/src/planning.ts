import { z } from 'zod';
import { quantityText, quantityUnits } from './decimal.js';
import { workflowDateSchema, workflowQuantitySchema } from './workflow.js';

export const planningId = z.coerce.number().int().positive();
export const versionSchema = z.object({ version: z.number().int().positive() }).strict();
const note = z.string().trim().max(1000).default('');
export const planningQuerySchema = z.object({ search: z.string().trim().max(100).default(''), status: z.string().max(30).default(''), page: planningId.default(1), pageSize: planningId.max(200).default(20) });
export type PlanningQuery = z.infer<typeof planningQuerySchema>;
const zeroQuantity = z.union([z.string(), z.number()]).transform((v, ctx) => {
  try { const units = quantityUnits(v); if (units < 0n) throw new Error('数量不能为负'); return quantityText(units); }
  catch (e) { ctx.addIssue({ code: 'custom', message: (e as Error).message }); return z.NEVER; }
});
const productIds = z.array(planningId).min(1).max(200).refine(ids => new Set(ids).size === ids.length, '物品不能重复');
export const stocktakeCreateSchema = z.object({ title: z.string().trim().min(1).max(100), note, productIds }).strict();
export const stocktakeSaveSchema = z.object({ version: versionSchema.shape.version, title: stocktakeCreateSchema.shape.title, note,
  lines: z.array(z.object({ productId: planningId, actualQuantity: zeroQuantity.nullable(), reason: note }).strict()).min(1).max(200)
    .refine(lines => new Set(lines.map(l => l.productId)).size === lines.length, '物品不能重复'),
}).strict();
export const stocktakeRecountSchema = versionSchema.extend({ productIds });
export const planningReasonSchema = versionSchema.extend({ reason: z.string().trim().min(1).max(500) });
export type StocktakeCreateInput = z.infer<typeof stocktakeCreateSchema>;
export type StocktakeSaveInput = z.infer<typeof stocktakeSaveSchema>;
export interface StocktakeLineRow { otherDraftIds?: number[]; stockChanges?: { documentId: number; quantity: string; date: string }[]; productId: number; itemName: string; specification: string; unit: string; baselineQuantity: string; actualQuantity: string | null; currentQuantity: string; difference: string | null; stale: boolean; reason: string; baselineAt: string }
export interface StocktakeRow { id: number; title: string; note: string; status: string; version: number; createdAt: string; postedAt: string | null; adjustmentDocumentId: number | null; voidReason: string | null; lines: StocktakeLineRow[] }

export const stockPolicySchema = z.object({ version: z.number().int().nonnegative(), enabled: z.boolean(), minimum: zeroQuantity, target: workflowQuantitySchema, multiple: workflowQuantitySchema.nullable(), note }).strict()
  .refine(p => quantityUnits(p.minimum) <= quantityUnits(p.target), '目标库存不能少于安全库存');
export type StockPolicyInput = z.infer<typeof stockPolicySchema>;
export interface StockPolicyRow { productId: number; enabled: boolean; minimum: string; target: string; multiple: string | null; note: string; version: number }
export interface ReplenishmentSuggestion {
  productId: number; itemName: string; specification: string; unit: string; policy: StockPolicyRow;
  stock: string; pendingPurchase: string; pendingReceipt: string; receiving: string; drafts: string; suggested: string; low: boolean; token: string;
  sources: { type: 'REQUEST' | 'DRAFT'; id: number; label: string; quantity: string }[];
}
const replenishmentLine = z.object({ productId: planningId, quantity: workflowQuantitySchema, token: z.string().regex(/^[a-f0-9]{64}$/), reason: note }).strict();
export const replenishmentDraftSchema = z.object({ title: stocktakeCreateSchema.shape.title, department: z.string().trim().max(100).default(''), handler: z.string().trim().max(100).default(''), requestDate: workflowDateSchema, note,
  lines: z.array(replenishmentLine).min(1).max(200).refine(lines => new Set(lines.map(l => l.productId)).size === lines.length, '物品不能重复'),
}).strict();
export const replenishmentSaveSchema = replenishmentDraftSchema.extend({ version: versionSchema.shape.version });
export const replenishmentConfirmSchema = versionSchema.extend({ autoSerial: z.boolean().default(true), serialNumber: z.string().trim().max(100).default(''), tokens: z.array(z.object({ productId: planningId, token: replenishmentLine.shape.token }).strict()).min(1).max(200) });
export type ReplenishmentDraftInput = z.infer<typeof replenishmentDraftSchema>;
export type ReplenishmentConfirmInput = z.infer<typeof replenishmentConfirmSchema>;
export interface ReplenishmentDraftRow { id: number; title: string; department: string; handler: string; requestDate: string; note: string; status: string; version: number; requestId: number | null; requestSerial: string | null; createdAt: string;
  lines: { productId: number; itemName: string; specification: string; unit: string; quantity: string; reason: string }[];
}
export const followupTargetSchema = z.object({ kind: z.enum(['ARRIVAL', 'INVOICE']), targetId: planningId, version: z.number().int().nonnegative() });
export const followupPlanSchema = followupTargetSchema.extend({ expectedDate: workflowDateSchema.nullable(), nextDate: workflowDateSchema.nullable(), note }).strict();
export const followupBatchSchema = z.object({ targets: z.array(followupTargetSchema.strict()).min(1).max(200).refine(a => new Set(a.map(t => `${t.kind}:${t.targetId}`)).size === a.length, '跟进对象不能重复'), expectedDate: workflowDateSchema.nullable(), nextDate: workflowDateSchema.nullable(), note }).strict();
export const followupEntrySchema = versionSchema.extend({ note: z.string().trim().min(1).max(1000), nextDate: workflowDateSchema.nullable().optional() });
export type FollowupPlanInput = z.infer<typeof followupPlanSchema>;
export interface FollowupRow { key: string; kind: 'ARRIVAL' | 'INVOICE'; targetId: number; planId: number | null; version: number; documentId: number; supplierName: string | null; purchaseDate: string; label: string; quantity: string | null; unit: string | null; requests: { id: number; serialNumber: string }[]; expectedDate: string | null; nextDate: string | null; dismissed: boolean; dismissReason: string | null; state: 'ACTIVE' | 'COMPLETED' | 'VOIDED'; overdue: boolean; due: boolean; replacement: boolean; latestNote: string | null; waitingDays: number; stateReason: string; replacements: { documentId: number; quantity: string; reason: string | null }[] }
export interface FollowupEntryRow { id: number; createdAt: string; note: string; changed: string }
export interface PlanningSummary { draftStocktakes: number; needsReplenishment: number; dueFollowups: number }
