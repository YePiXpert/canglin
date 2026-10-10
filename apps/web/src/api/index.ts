import { http } from './client';

export { http, apiError, bindRouter } from './client';
import type {
  AiAskInput,
  AiAskResponse,
  AiConfigInput,
  AiConfigView,
  AiOcrReviewResult,
  AutoBackupConfig,
  WorkflowImportConfirmInput,
  ParseResult,
  ImportDraft,
  SupplierUpsertInput,
} from '@canglin/shared';

/* ------------------------------- 通用分页结构 ------------------------------ */
export interface Paged {
  total: number;
  page: number;
  pageSize: number;
}

/* ---------------------------------- 导入 ---------------------------------- */
export interface AiImportPage {
  page: number;
  serialNumber: string | null;
  department: string | null;
  handler: string | null;
  requestDate: string | null;
  items: {
    lineId: string | null;
    itemName: string;
    spec?: string | null;
    quantity: number | null;
    unit: string | null;
    unitPrice: number | null;
    purchaseLink: string | null;
    reason: string;
  }[];
  warnings: string[];
}
export interface ImportTaskView {
  id: string;
  filename: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  result?: ParseResult;
  error?: string;
  version: number;
  draft?: ImportDraft;
  aiStatus: string;
  aiResult: AiImportPage[];
  reviewPages: { page: number; reasons: string[]; reviewed: boolean }[];
  confirmed: boolean;
  requestId?: number;
  originalAvailable: boolean;
  calls: {
    id: string;
    page: number | null;
    model: string;
    status: string;
    error?: string;
    inputTokens: number | null;
    outputTokens: number | null;
    cost: number | null;
    durationMs: number | null;
  }[];
}
/** 导入任务列表的一行（找回未完成的导入；按 confirmedAt 区分是否已入账） */
export interface ImportTaskSummary {
  id: string;
  filename: string;
  createdAt: string;
  finishedAt: string | null;
  status: ImportTaskView['status'];
  aiStatus: string;
  confirmed: boolean;
  confirmedAt: string | null;
  originalAvailable: boolean;
}
export interface ImportTasksPage extends Paged {
  tasks: ImportTaskSummary[];
}
/** Keep an uncertain operation's key across retries and browser reloads. Clear only after a known result. */
async function mutation<T>(url: string, body?: unknown): Promise<T> {
  const key = 'procure-operation:' + url + ':' + JSON.stringify(body ?? {});
  const id = sessionStorage.getItem(key) || crypto.randomUUID();
  sessionStorage.setItem(key, id);
  // 失败时保留 key：下次重试沿用同一个 Idempotency-Key
  const response = await http.post<T>(url, body, { headers: { 'Idempotency-Key': id } });
  sessionStorage.removeItem(key);
  return response.data;
}
export const importsApi = {
  upload: (file: File, continueDuplicate = false) => {
    const form = new FormData();
    form.append('file', file);
    return http
      .post<{ taskId?: string; duplicateTaskId?: string }>('/imports/upload', form, {
        params: { continueDuplicate },
        headers: { 'content-type': 'multipart/form-data' },
        timeout: 200_000,
      })
      .then((r) => r.data);
  },
  revisions: (id: string) =>
    http
      .get<
        { id: number; kind: string; version: number; snapshot: string; createdAt: string }[]
      >(`/imports/tasks/${id}/revisions`)
      .then((r) => r.data),
  /** 只读列表：confirmed=false 是未确认入账的任务（含本地识别已完成的） */
  tasks: (params: { confirmed?: boolean; page?: number; pageSize?: number }) =>
    http.get<ImportTasksPage>('/imports/tasks', { params }).then((r) => r.data),
  task: (id: string) => http.get<ImportTaskView>(`/imports/tasks/${id}`).then((r) => r.data),
  saveDraft: (id: string, version: number, draft: ImportDraft) =>
    http
      .put<{ version: number }>(`/imports/tasks/${id}/draft`, { version, draft })
      .then((r) => r.data),
  retry: (id: string, stage: 'local' | 'ai', pages?: number[]) =>
    http.post(`/imports/tasks/${id}/retry`, { stage, pages }),
  cancel: (id: string) => http.post(`/imports/tasks/${id}/cancel`),
  confirmRequest: (body: WorkflowImportConfirmInput) =>
    mutation<{ requestId: number; created: number; merged: number; skipped: number; attached: number }>('/workflow/imports/confirm', body),
};

/* ---------------------------------- 附件 ---------------------------------- */
export interface AttachmentRow {
  id: number;
  kind: string;
  procurementRequestId?: number | null;
  businessDocumentId?: number | null;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
}
export const attachmentsApi = {
  list: (params: { procurementRequestId?: number; businessDocumentId?: number }) =>
    http.get<AttachmentRow[]>('/attachments', { params }).then((r) => r.data),
  remove: (id: number) => http.delete(`/attachments/${id}`).then((r) => r.data),
  uploadForRequest: (requestId: number, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return http.post<AttachmentRow>(`/attachments/requests/${requestId}`, form).then((r) => r.data);
  },
  uploadForDocument: (documentId: number, file: File, kind: 'INVOICE' | 'SIGNOFF') => {
    const form = new FormData();
    form.append('file', file);
    return http.post<AttachmentRow>(`/attachments/documents/${documentId}`, form, { params: { kind } }).then((r) => r.data);
  },
};

/* --------------------------------- 供应商 ---------------------------------- */
export interface SupplierRow {
  id: number;
  name: string;
  contact: string | null;
  phone: string | null;
  note: string | null;
  _count?: { businessDocuments: number };
}
export const suppliersApi = {
  list: () => http.get<SupplierRow[]>('/suppliers').then((r) => r.data),
  upsert: (body: SupplierUpsertInput) =>
    http.post<SupplierRow>('/suppliers', body).then((r) => r.data),
  remove: (id: number) => http.delete(`/suppliers/${id}`).then((r) => r.data),
};

/* ---------------------------------- 系统 ---------------------------------- */
export interface SystemStatus {
  version: string;
  uptimeSeconds: number;
  dbSizeBytes: number;
  /** 申请单 / 物品目录 / 已过账（POSTED）的业务单据 */
  counts: { requests: number; products: number; documents: number };
  /** 最近一次库存核对：mismatches = 库存余额与流水重算不一致的物品数 */
  stockCheck?: { checkedAt: string | null; mismatches: number };
  autoBackup: AutoBackupConfig;
  restoring: boolean;
}
export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
}
export const systemApi = {
  status: () => http.get<SystemStatus>('/system/status').then((r) => r.data),
  ocrHealth: () =>
    http
      .get<boolean>('/system/ocr-health')
      .then((r) => r.data)
      .catch(() => false),
  backups: () => http.get<BackupInfo[]>('/system/backups').then((r) => r.data),
  createBackup: () => http.post<BackupInfo>('/system/backups').then((r) => r.data),
  restoreBackup: (name: string) => http.post(`/system/backups/${name}/restore`).then((r) => r.data),
  deleteBackup: (name: string) => http.delete(`/system/backups/${name}`).then((r) => r.data),
  getAutoBackup: () => http.get<AutoBackupConfig>('/system/auto-backup').then((r) => r.data),
  updateAutoBackup: (body: AutoBackupConfig) =>
    http.put('/system/auto-backup', body).then((r) => r.data),
};

/* ----------------------------------- AI ----------------------------------- */
export const aiApi = {
  models: () => http.get<{ models: string[] }>('/ai/models', { timeout: 20_000 }).then((r) => r.data),
  capabilities: () =>
    http
      .post<
        NonNullable<import('@canglin/shared').AiConfigView['capabilities']>
      >('/ai/capabilities')
      .then((r) => r.data),
  config: () => http.get<AiConfigView>('/ai/config').then((r) => r.data),
  /** apiKey 留空 = 保留已保存的 Key */
  updateConfig: (body: AiConfigInput) =>
    http.put<AiConfigView>('/ai/config', body).then((r) => r.data),
  health: () => http.get<{ ok: boolean; reason?: string }>('/ai/health').then((r) => r.data),
  ask: (body: AiAskInput) =>
    // 问答要跑多轮工具调用，放宽到与导入上传同级的超时
    http.post<AiAskResponse>('/ai/ask', body, { timeout: 180_000 }).then((r) => r.data),
  ocrReview: (taskId: string) =>
    http
      .post<AiOcrReviewResult>('/ai/ocr-review', { taskId }, { timeout: 120_000 })
      .then((r) => r.data),
};

/* ---------------------------------- 审计 ---------------------------------- */
export interface AuditRow {
  id: number;
  action: string;
  entity: string | null;
  entityId: number | null;
  detail: string | null;
  operatorIp: string | null;
  createdAt: string;
}
export const auditApi = {
  list: (params: { action?: string; search?: string; page?: number; pageSize?: number }) =>
    http.get<Paged & { logs: AuditRow[] }>('/audit-logs', { params }).then((r) => r.data),
};

/** 浏览器下载 API 生成的文件（同源带 Cookie） */
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const res = await http.get(url, { responseType: 'blob' });
  const disposition = res.headers['content-disposition'] as string | undefined;
  const match = disposition?.match(/filename\*?=(?:UTF-8'')?["']?([^"';]+)/i);
  const name = match ? decodeURIComponent(match[1]) : fallbackName;
  const blobUrl = URL.createObjectURL(res.data as Blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = name;
  a.click();
  URL.revokeObjectURL(blobUrl);
}
