import type { BusinessLine, Prisma, ProcurementLine } from '@prisma/client';

/** Prisma shapes and pure helpers shared by the write side (WorkflowService) and the read side (WorkflowQueryService). */
export const attachmentSelect = { id: true, kind: true, filename: true } as const;
export const requestInclude = { lines: { orderBy: { lineNumber: 'asc' as const } }, attachments: { select: attachmentSelect } } as const;
export const documentInclude = { stocktake: { select: { id: true } }, lines: { orderBy: { id: 'asc' as const }, include: { requestLine: { include: { request: true } } } }, attachments: { select: attachmentSelect } } as const;
export type RequestRecord = Prisma.ProcurementRequestGetPayload<{ include: typeof requestInclude }>;
export type DocumentRecord = Prisma.BusinessDocumentGetPayload<{ include: typeof documentInclude }>;
export type Tx = Prisma.TransactionClient;

export function sum(values: bigint[]): bigint { return values.reduce((total, value) => total + value, 0n); }
export function snapshot(line: Pick<BusinessLine | ProcurementLine, 'productId' | 'itemName' | 'specification' | 'unit'>) {
  return { productId: line.productId, itemName: line.itemName, specification: line.specification, unit: line.unit };
}
