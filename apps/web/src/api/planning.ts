import { http, mutate } from './client';
import type { StocktakeRow, StocktakeCreateInput, StocktakeSaveInput, PlanningQuery, PlanningSummary, WorkflowPage, ReplenishmentSuggestion, ReplenishmentDraftRow, ReplenishmentDraftInput, ReplenishmentConfirmInput, StockPolicyInput, FollowupRow, FollowupEntryRow, FollowupPlanInput } from '@canglin/shared';
const get = <T>(path: string, params?: object) => http.get<T>(`/planning${path}`, { params }).then(r => r.data);
const write = <T>(path: string, body: unknown, method: 'post' | 'patch' = 'post') => mutate<T>(method, `/planning${path}`, body, `canglin-planning:${path}:${JSON.stringify(body)}`);
export type CountHeader = Omit<StocktakeRow, 'lines'> & { _count: { lines: number } };
export type FollowupFilters = Partial<PlanningQuery> & { kind?: 'ARRIVAL' | 'INVOICE'; due?: '1'; requestId?: number; supplierId?: number; dateFrom?: string; dateTo?: string };
export const planningApi = {
  summary: () => get<PlanningSummary>('/summary'),
  counts: (params: Partial<PlanningQuery>) => get<WorkflowPage<CountHeader>>('/counts', params),
  count: (id: number) => get<StocktakeRow>(`/counts/${id}`),
  createCount: (body: StocktakeCreateInput) => write<StocktakeRow>('/counts', body),
  saveCount: (id: number, body: StocktakeSaveInput) => write<StocktakeRow>(`/counts/${id}`, body, 'patch'),
  recount: (id: number, version: number, productIds: number[]) => write<StocktakeRow>(`/counts/${id}/recount`, { version, productIds }),
  postCount: (id: number, version: number) => write<StocktakeRow>(`/counts/${id}/post`, { version }),
  closeCount: (id: number, version: number, action: 'cancel' | 'void', reason: string) => write<StocktakeRow>(`/counts/${id}/${action}`, { version, reason }),
  suggestions: (excludeDraftId?: number) => get<ReplenishmentSuggestion[]>('/replenishment/suggestions', { excludeDraftId }),
  policies: (items: { productId: number; policy: StockPolicyInput }[]) => write('/replenishment/policies', { items }, 'patch'),
  drafts: (params: Partial<PlanningQuery>) => get<WorkflowPage<ReplenishmentDraftRow>>('/replenishment/drafts', params),
  draft: (id: number) => get<ReplenishmentDraftRow>(`/replenishment/drafts/${id}`),
  createDraft: (body: ReplenishmentDraftInput) => write<ReplenishmentDraftRow>('/replenishment/drafts', body),
  saveDraft: (id: number, body: ReplenishmentDraftInput & { version: number }) => write<ReplenishmentDraftRow>(`/replenishment/drafts/${id}`, body, 'patch'),
  confirmDraft: (id: number, body: ReplenishmentConfirmInput) => write<ReplenishmentDraftRow>(`/replenishment/drafts/${id}/confirm`, body),
  discardDraft: (id: number, version: number, reason: string) => write<ReplenishmentDraftRow>(`/replenishment/drafts/${id}/discard`, { version, reason }),
  followups: (params: FollowupFilters) => get<WorkflowPage<FollowupRow> & { today: string; summary: { due: number; overdue: number; unplanned: number } }>('/followups', params),
  history: (row: FollowupRow) => get<FollowupEntryRow[]>('/followups/history', { kind: row.kind, targetId: row.targetId }),
  plans: (rows: FollowupRow[], body: Pick<FollowupPlanInput, 'expectedDate' | 'nextDate' | 'note'>) => write('/followups/plans', { targets: rows.map(r => ({ kind: r.kind, targetId: r.targetId, version: r.version })), ...body }, 'patch'),
  dismiss: (row: FollowupRow, dismissed: boolean, reason: string) => write('/followups/dismiss', { kind: row.kind, targetId: row.targetId, version: row.version, dismissed, reason }, 'patch'),
};
