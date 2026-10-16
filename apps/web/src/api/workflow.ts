import { http, mutate } from './client';
import type {
  WorkflowDocumentKind, WorkflowDocumentRow, WorkflowOverview, WorkflowPage,
  WorkflowPurchaseInput, WorkflowQuery, WorkflowReceiptInput, WorkflowRequestCreateInput,
  WorkflowRequestRow, WorkflowStockEntryRow, WorkflowStockRow,
  WorkflowStockInInput, WorkflowDistributionInput, WorkflowSupplierReturnInput,
  WorkflowEmployeeReturnInput, WorkflowPurchaseCancelInput, WorkflowRequestCancelInput,
  WorkflowAdjustmentInput, WorkflowVoidInput, WorkflowMetadataInput, WorkflowProductCreateInput,
  WorkflowPriceRow, WorkflowProductRow, WorkflowLinkUpdateInput, WorkflowRequestUpdateInput, WorkflowDirectory,
} from '@canglin/shared';

export type {
  WorkflowDocumentKind, WorkflowDocumentLineRow, WorkflowDocumentRow, WorkflowOverview,
  WorkflowPage, WorkflowRequestLineRow, WorkflowRequestRow, WorkflowStockRow, WorkflowProductRow, WorkflowDirectory,
} from '@canglin/shared';

/** 业务写操作：经 mutate 带 Idempotency-Key；会话里的键沿用 `canglin-workflow:{path}:{body}` 的写法 */
function write<T>(method: 'post' | 'patch', path: string, body: unknown): Promise<T> {
  return mutate<T>(method, `/workflow${path}`, body, `canglin-workflow:${path}:${JSON.stringify(body)}`);
}
const post = <T>(path: string, body: unknown) => write<T>('post', path, body);

export const workflowApi = {
  requests: (params: Partial<WorkflowQuery> = {}) =>
    http.get<WorkflowPage<WorkflowRequestRow>>('/workflow/requests', { params }).then((r) => r.data),
  request: (id: number) => http.get<WorkflowRequestRow>(`/workflow/requests/${id}`).then((r) => r.data),
  createRequest: (body: WorkflowRequestCreateInput) => post<WorkflowRequestRow>('/requests', body),
  /** 修改申请信息（流水号、申请日期、部门、经办人、备注），补填 OA 流水号也走这里 */
  updateRequest: (id: number, body: WorkflowRequestUpdateInput) => write<WorkflowRequestRow>('patch', `/requests/${id}`, body),
  /** 部门与人员的候选（已有申请与未撤销发放单的汇总） */
  directory: () => http.get<WorkflowDirectory>('/workflow/directory').then((r) => r.data),
  /** 删除没有业务记录的申请；导入的申请删除后导入任务退回待核对 */
  deleteRequest: (id: number) => post<{ deleted: true; requestId: number; sourceTaskId: string | null }>(`/requests/${id}/delete`, {}),
  updateRequestLineLink: (id: number, body: WorkflowLinkUpdateInput) => write<WorkflowRequestRow>('patch', `/request-lines/${id}/link`, body),
  updatePurchaseLineLink: (id: number, body: WorkflowLinkUpdateInput) => write<WorkflowDocumentRow>('patch', `/purchase-lines/${id}/link`, body),
  /** 物品库（品名 + 规格 + 单位） */
  products: () => http.get<WorkflowProductRow[]>('/workflow/products').then((r) => r.data),
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
  metadata: (id: number, body: WorkflowMetadataInput) => write<WorkflowDocumentRow>('patch', `/documents/${id}/metadata`, body),
};
