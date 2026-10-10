import { http } from './client';
import type {
  WorkflowDocumentKind, WorkflowDocumentRow, WorkflowOverview, WorkflowPage,
  WorkflowPurchaseInput, WorkflowQuery, WorkflowReceiptInput, WorkflowRequestCreateInput,
  WorkflowRequestRow, WorkflowStockEntryRow, WorkflowStockRow,
  WorkflowStockInInput, WorkflowDistributionInput, WorkflowSupplierReturnInput,
  WorkflowEmployeeReturnInput, WorkflowPurchaseCancelInput, WorkflowRequestCancelInput,
  WorkflowAdjustmentInput, WorkflowVoidInput, WorkflowMetadataInput, WorkflowProductCreateInput,
  WorkflowPriceRow,
} from '@canglin/shared';

export type {
  WorkflowDocumentKind, WorkflowDocumentLineRow, WorkflowDocumentRow, WorkflowOverview,
  WorkflowPage, WorkflowRequestLineRow, WorkflowRequestRow, WorkflowStockRow,
} from '@canglin/shared';

/** Preserve an uncertain submission's key through retries and browser reloads. */
async function post<T>(path: string, body: unknown): Promise<T> {
  const key = `procure-workflow:${path}:${JSON.stringify(body)}`;
  const operationId = sessionStorage.getItem(key) || crypto.randomUUID();
  sessionStorage.setItem(key, operationId);
  const response = await http.post<T>(`/workflow${path}`, body, {
    headers: { 'Idempotency-Key': operationId },
  });
  sessionStorage.removeItem(key);
  return response.data;
}

export const workflowApi = {
  requests: (params: Partial<WorkflowQuery> = {}) =>
    http.get<WorkflowPage<WorkflowRequestRow>>('/workflow/requests', { params }).then((r) => r.data),
  request: (id: number) => http.get<WorkflowRequestRow>(`/workflow/requests/${id}`).then((r) => r.data),
  createRequest: (body: WorkflowRequestCreateInput) => post<WorkflowRequestRow>('/requests', body),
  purchase: (body: WorkflowPurchaseInput) => post<WorkflowDocumentRow>('/purchases', body),
  receipt: (body: WorkflowReceiptInput) => post<WorkflowDocumentRow>('/receipts', body),
  documents: (params: Partial<WorkflowQuery> & { kind?: WorkflowDocumentKind } = {}) =>
    http.get<WorkflowPage<WorkflowDocumentRow>>('/workflow/documents', { params }).then((r) => r.data),
  document: (id: number) => http.get<WorkflowDocumentRow>(`/workflow/documents/${id}`).then((r) => r.data),
  lineDocument: (id: number) => http.get<WorkflowDocumentRow>(`/workflow/lines/${id}/document`).then((r) => r.data),
  prices: (params: { productId?: number; supplierId?: number; search?: string } = {}) =>
    http.get<WorkflowPriceRow[]>('/workflow/prices', { params }).then((r) => r.data),
  stock: (params: { search?: string; productId?: number } = {}) =>
    http.get<WorkflowStockRow[]>('/workflow/stock', { params }).then((r) => r.data),
  entries: (params: Partial<WorkflowQuery> = {}) =>
    http.get<WorkflowPage<WorkflowStockEntryRow>>('/workflow/entries', { params }).then((r) => r.data),
  overview: () => http.get<WorkflowOverview>('/workflow/overview').then((r) => r.data),
  stockIn: (body: WorkflowStockInInput) => post<WorkflowDocumentRow>('/stock-in', body),
  distribute: (body: WorkflowDistributionInput) => post<WorkflowDocumentRow>('/distributions', body),
  supplierReturn: (body: WorkflowSupplierReturnInput) => post<WorkflowDocumentRow>('/supplier-returns', body),
  employeeReturn: (body: WorkflowEmployeeReturnInput) => post<WorkflowDocumentRow>('/employee-returns', body),
  cancelPurchase: (body: WorkflowPurchaseCancelInput) => post<WorkflowDocumentRow>('/purchase-cancellations', body),
  cancelRequest: (body: WorkflowRequestCancelInput) => post<WorkflowDocumentRow>('/request-cancellations', body),
  adjust: (body: WorkflowAdjustmentInput) => post<WorkflowDocumentRow>('/adjustments', body),
  voidDocument: (id: number, body: WorkflowVoidInput) => post<WorkflowDocumentRow>(`/documents/${id}/void`, body),
  createProduct: (body: WorkflowProductCreateInput) => post<{ productId: number; itemName: string; specification: string; unit: string }>('/products', body),
  metadata: async (id: number, body: WorkflowMetadataInput) => {
    const path = `/documents/${id}/metadata`;
    const key = `procure-workflow:${path}:${JSON.stringify(body)}`;
    const operationId = sessionStorage.getItem(key) || crypto.randomUUID();
    sessionStorage.setItem(key, operationId);
    const response = await http.patch<WorkflowDocumentRow>(`/workflow${path}`, body, { headers: { 'Idempotency-Key': operationId } });
    sessionStorage.removeItem(key);
    return response.data;
  },
};
