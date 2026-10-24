import { http, mutate } from './client';
import type { DraftContextRow, AiProposalInput, BatchCreateInput, BatchRow, BatchSaveInput, DemandRow, ExceptionActionInput, ExceptionRow, ExceptionRules, ExecutionDraftRow, ExecutionPayload, ExecutionQuery, FinancialCreateInput, FinancialRow, InvoiceAllocationInput, InvoiceInput, InvoiceRow, MonthlyReview, OpeningInput, SettlementRow, WorkflowPage } from '@canglin/shared';
const get = <T>(path: string, params?: object) => http.get<T>(`/execution${path}`, { params }).then(r => r.data);
const write = <T>(path: string, body: unknown, method: 'post' | 'patch' = 'post') => mutate<T>(method, `/execution${path}`, body);
export interface BatchHeader { id: number; title: string; date: string; status: string; version: number; _count: { lines: number; documents: number } }
export type ActionHeader = Pick<ExecutionDraftRow, 'id' | 'title' | 'kind' | 'source' | 'status' | 'version' | 'createdAt' | 'updatedAt'>;
export interface InvoiceRecognition { number: string | null; date: string | null; amount: string | null; supplierName: string | null; supplierId: number | null; warning: string; page: number; pageCount: number }
export const executionApi = {
  recognizeInvoice: (file: File, mode: 'LOCAL' | 'AI', page: number, key: string) => { const data = new FormData(); data.append('file', file); return http.post<InvoiceRecognition>('/execution/invoice-recognition', data, { params: { mode, page }, headers: { 'Idempotency-Key': key }, timeout: 240_000 }).then(r => r.data); },
  demands: (q: Partial<ExecutionQuery>) => get<WorkflowPage<DemandRow>>('/demands', q),
  batches: (q: Partial<ExecutionQuery>) => get<WorkflowPage<BatchHeader>>('/batches', q),
  batch: (id: number) => get<BatchRow>(`/batches/${id}`),
  createBatch: (b: BatchCreateInput) => write<BatchRow>('/batches', b),
  saveBatch: (id: number, b: BatchSaveInput) => write<BatchRow>(`/batches/${id}`, b, 'patch'),
  confirmBatch: (id: number, version: number) => write<BatchRow>(`/batches/${id}/confirm`, { version }),
  cancelBatch: (id: number, version: number, date: string, reason: string) => write<BatchRow>(`/batches/${id}/cancel`, { version, date, reason }),
  settlements: (q: Partial<ExecutionQuery>) => get<WorkflowPage<SettlementRow>>('/settlements', q),
  opening: (id: number, b: OpeningInput) => write<SettlementRow>(`/settlements/${id}/opening`, b),
  records: (q: Partial<ExecutionQuery>) => get<WorkflowPage<FinancialRow>>('/financial-records', q),
  record: (id: number) => get<FinancialRow>(`/financial-records/${id}`),
  createRecord: (b: FinancialCreateInput) => write<FinancialRow>('/financial-records', b),
  voidRecord: (id: number, version: number, date: string, reason: string) => write<FinancialRow>(`/financial-records/${id}/void`, { version, date, reason }),
  invoices: (q: Partial<ExecutionQuery>) => get<WorkflowPage<InvoiceRow>>('/invoices', q),
  invoice: (id: number) => get<InvoiceRow>(`/invoices/${id}`),
  createInvoice: (b: InvoiceInput) => write<InvoiceRow>('/invoices', b),
  saveInvoice: (id: number, b: InvoiceInput & { version: number }) => write<InvoiceRow>(`/invoices/${id}`, b, 'patch'),
  allocateInvoice: (id: number, b: InvoiceAllocationInput) => write<InvoiceRow>(`/invoices/${id}/allocations`, b, 'patch'),
  postInvoice: (id: number, version: number) => write<InvoiceRow>(`/invoices/${id}/post`, { version }),
  voidInvoice: (id: number, version: number, date: string, reason: string) => write<InvoiceRow>(`/invoices/${id}/void`, { version, date, reason }),
  exceptions: (q: Partial<ExecutionQuery>) => get<WorkflowPage<ExceptionRow> & { active: number; today: string }>('/exceptions', q),
  exceptionAction: (b: ExceptionActionInput) => write('/exceptions/action', b),
  exceptionHistory: (key: string) => get<{ id: number; action: string; reason: string; untilDate: string | null; createdAt: string }[]>('/exceptions/history', { key }),
  rules: () => get<ExceptionRules>('/exceptions/rules'),
  saveRules: (b: ExceptionRules) => write<ExceptionRules>('/exceptions/rules', b, 'patch'),
  monthly: (month: string) => get<MonthlyReview>('/monthly-review', { month }),
  drafts: (q: Partial<ExecutionQuery>) => get<WorkflowPage<ActionHeader>>('/drafts', q),
  draftContext: (id: number) => get<DraftContextRow[]>(`/drafts/${id}/context`),
  draft: (id: number) => get<ExecutionDraftRow>(`/drafts/${id}`),
  createDraft: (b: { title: string; action: ExecutionPayload }) => write<ExecutionDraftRow>('/drafts', b),
  saveDraft: (id: number, b: { version: number; title: string; action: ExecutionPayload }) => write<ExecutionDraftRow>(`/drafts/${id}`, b, 'patch'),
  recheckDraft: (id: number, version: number) => write<ExecutionDraftRow>(`/drafts/${id}/recheck`, { version }),
  executeDraft: (id: number, version: number) => write<ExecutionDraftRow>(`/drafts/${id}/execute`, { version }),
  discardDraft: (id: number, version: number, date: string, reason: string) => write<ExecutionDraftRow>(`/drafts/${id}/discard`, { version, date, reason }),
  propose: (b: AiProposalInput) => write<ExecutionDraftRow>('/ai-proposals', b),
};
