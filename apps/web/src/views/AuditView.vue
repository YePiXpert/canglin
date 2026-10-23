<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import Icon from '@/components/ui/Icon.vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import NativeSelect from '@/components/ui/NativeSelect.vue';
import SearchInput from '@/components/ui/SearchInput.vue';
import Pagination from '@/components/ui/Pagination.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Panel from '@/components/ui/Panel.vue';
import { auditApi, type AuditRow } from '@/api';
import { formatDateTime } from '@/utils/datetime';
import { useUrlState } from '@/composables/useUrlState';
import { useResource } from '@/composables/useResource';
import { ITEM_FIELD_LABELS, PAYMENT_STATUS_LABELS, type PaymentStatus } from '@canglin/shared';

const DEFAULTS = { search: '', action: '', page: 1 };
const filters = reactive({ ...DEFAULTS });
useUrlState(filters, DEFAULTS);

const pageSize = 30;
/* 首次加载画骨架；换筛选、翻页时保留旧表格，失败原位 ErrorState（过期响应丢弃） */
const { data, loading, error: loadError, load } = useResource(() =>
  auditApi.list({
    ...(filters.search ? { search: filters.search } : {}),
    ...(filters.action ? { action: filters.action } : {}),
    page: filters.page,
    pageSize,
  }),
);
const logs = computed<AuditRow[]>(() => data.value?.logs ?? []);
const total = computed(() => data.value?.total ?? 0);
const expanded = ref<Set<number>>(new Set());

/**
 * 操作类型 chip 的颜色只标出需要留意的动作（「墨线」：颜色是信息，不按类别上色）：
 * 失败、删除、作废与库存核对不一致 red · 覆盖或回退数据的动作（恢复备份、改密、重置恢复码、回滚、撤销登记）amber · 其余 gray。
 * group 是筛选下拉里的分组前缀。
 */
const ACTION_LABELS: Record<string, { label: string; tone: 'amber' | 'red' | 'gray'; group: string; legacy?: boolean }> = {
  AUTH_SETUP: { label: '初始化', tone: 'gray', group: '账号' },
  AUTH_LOGIN: { label: '登录', tone: 'gray', group: '账号' },
  AUTH_LOGIN_FAILED: { label: '登录失败', tone: 'red', group: '账号' },
  AUTH_RECOVER: { label: '恢复密码', tone: 'amber', group: '账号' },
  AUTH_RECOVER_FAILED: { label: '恢复码错误', tone: 'red', group: '账号' },
  AUTH_CHANGE_PASSWORD: { label: '修改密码', tone: 'amber', group: '账号' },
  AUTH_REGENERATE_RECOVERY: { label: '重置恢复码', tone: 'amber', group: '账号' },
  // 申请、采购、到货、库存与领用的业务登记（服务端按 WORKFLOW_<操作> 记录）
  WORKFLOW_REQUEST: { label: '人工录入申请', tone: 'gray', group: '申请' },
  REQUEST_IMPORT_CONFIRM: { label: '导入生成申请', tone: 'gray', group: '申请' },
  WORKFLOW_REQUEST_CANCEL: { label: '取消未采购量', tone: 'gray', group: '申请' },
  WORKFLOW_REQUEST_DELETE: { label: '删除申请', tone: 'red', group: '申请' },
  WORKFLOW_REQUEST_UPDATE: { label: '修改申请信息', tone: 'gray', group: '申请' },
  WORKFLOW_REQUEST_LINE_LINK: { label: '修改申请链接', tone: 'gray', group: '申请' },
  WORKFLOW_PURCHASE_LINE_LINK: { label: '修改采购链接', tone: 'gray', group: '采购' },
  WORKFLOW_PURCHASE: { label: '登记采购', tone: 'gray', group: '采购' },
  WORKFLOW_PURCHASE_CANCEL: { label: '取消未到货量', tone: 'gray', group: '采购' },
  WORKFLOW_RECEIPT: { label: '登记到货', tone: 'gray', group: '采购' },
  WORKFLOW_SUPPLIER_RETURN: { label: '退回供应商', tone: 'gray', group: '采购' },
  WORKFLOW_STOCK_IN: { label: '登记入库', tone: 'gray', group: '库存' },
  WORKFLOW_ADJUSTMENT: { label: '盘点调整', tone: 'gray', group: '库存' },
  WORKFLOW_PRODUCT: { label: '新增库存物品', tone: 'gray', group: '库存' },
  STOCK_RECONCILE_MISMATCH: { label: '库存核对不一致', tone: 'red', group: '库存' },
  WORKFLOW_DISTRIBUTION: { label: '领用发放', tone: 'gray', group: '领用' },
  WORKFLOW_EMPLOYEE_RETURN: { label: '员工归还', tone: 'gray', group: '领用' },
  WORKFLOW_METADATA: { label: '修改付款与发票', tone: 'gray', group: '采购' },
  WORKFLOW_METADATA_BATCH: { label: '批量修改付款与开票', tone: 'gray', group: '采购' },
  WORKFLOW_VOID: { label: '撤销登记', tone: 'amber', group: '业务记录' },
  WORKFLOW_STOCKTAKE_CREATE: { label: '新建盘点', tone: 'gray', group: '库存' },
  WORKFLOW_STOCKTAKE_SAVE: { label: '保存盘点', tone: 'gray', group: '库存' },
  WORKFLOW_STOCKTAKE_RECOUNT: { label: '更新重盘快照', tone: 'amber', group: '库存' },
  WORKFLOW_STOCKTAKE_POST: { label: '盘点记账', tone: 'gray', group: '库存' },
  WORKFLOW_STOCKTAKE_CANCEL: { label: '取消盘点', tone: 'amber', group: '库存' },
  WORKFLOW_STOCKTAKE_VOID: { label: '撤销盘点', tone: 'amber', group: '库存' },
  WORKFLOW_STOCK_POLICY: { label: '设置补货规则', tone: 'gray', group: '补货' },
  WORKFLOW_REPLENISHMENT_CREATE: { label: '新建补货草稿', tone: 'gray', group: '补货' },
  WORKFLOW_REPLENISHMENT_SAVE: { label: '保存补货草稿', tone: 'gray', group: '补货' },
  WORKFLOW_REPLENISHMENT_CONFIRM: { label: '补货生成申请', tone: 'gray', group: '补货' },
  WORKFLOW_REPLENISHMENT_DISCARD: { label: '放弃补货草稿', tone: 'amber', group: '补货' },
  WORKFLOW_FOLLOWUP_PLAN: { label: '记录采购跟进', tone: 'gray', group: '跟进' },
  WORKFLOW_FOLLOWUP_DISMISS: { label: '停止采购跟进', tone: 'amber', group: '跟进' },
  WORKFLOW_FOLLOWUP_RESUME: { label: '恢复采购跟进', tone: 'gray', group: '跟进' },
  // 旧版台账已删除，保留这些动作名只为显示历史审计记录
  ITEM_CREATE: { label: '新增台账', tone: 'gray', group: '旧台账', legacy: true },
  ITEM_UPDATE: { label: '修改台账', tone: 'gray', group: '旧台账', legacy: true },
  ITEM_BATCH_UPDATE: { label: '批量修改台账', tone: 'gray', group: '旧台账', legacy: true },
  ITEM_PURCHASE: { label: '下单登记', tone: 'gray', group: '旧台账', legacy: true },
  ITEM_DELETE: { label: '删除台账', tone: 'red', group: '旧台账', legacy: true },
  ITEM_RESTORE: { label: '恢复台账', tone: 'gray', group: '旧台账', legacy: true },
  ITEM_PURGE: { label: '彻底删除台账', tone: 'red', group: '旧台账', legacy: true },
  ITEM_ROLLBACK: { label: '回滚台账', tone: 'amber', group: '旧台账', legacy: true },
  ITEM_STOCK_IN: { label: '采购入库', tone: 'gray', group: '旧台账', legacy: true },
  ITEM_STOCK_IN_BATCH: { label: '整单入库', tone: 'gray', group: '旧台账', legacy: true },
  AI_CONFIG_UPDATE: { label: '修改 AI 设置', tone: 'gray', group: 'AI' },
  AI_QUERY: { label: 'AI 问答', tone: 'gray', group: 'AI' },
  AI_OCR_REVIEW: { label: 'AI 复核单据', tone: 'gray', group: 'AI', legacy: true },
  DISTRIBUTION_CREATE: { label: '发放登记', tone: 'gray', group: '旧台账', legacy: true },
  DISTRIBUTION_REVOKE: { label: '作废发放', tone: 'red', group: '旧台账', legacy: true },
  IMPORT_UPLOAD: { label: '上传原件', tone: 'gray', group: '导入' },
  IMPORT_DISCARD: { label: '放弃草稿', tone: 'red', group: '导入' },
  IMPORT_CONFIRM: { label: '确认导入', tone: 'gray', group: '导入', legacy: true },
  PRODUCT_CREATE: { label: '新增物品', tone: 'gray', group: '旧台账', legacy: true },
  PRODUCT_UPDATE: { label: '修改物品', tone: 'gray', group: '旧台账', legacy: true },
  PRODUCT_DELETE: { label: '删除物品', tone: 'red', group: '旧台账', legacy: true },
  INVENTORY_MOVEMENT: { label: '库存流水', tone: 'gray', group: '旧台账', legacy: true },
  INVENTORY_MOVEMENT_DELETE: { label: '删除库存流水', tone: 'red', group: '旧台账', legacy: true },
  SUPPLIER_CREATE: { label: '新增供应商', tone: 'gray', group: '供应商' },
  SUPPLIER_UPDATE: { label: '修改供应商', tone: 'gray', group: '供应商' },
  SUPPLIER_DELETE: { label: '删除供应商', tone: 'red', group: '供应商' },
  PRICE_RECORD_CREATE: { label: '记录报价', tone: 'gray', group: '旧台账', legacy: true },
  PRICE_RECORD_DELETE: { label: '删除报价', tone: 'red', group: '旧台账', legacy: true },
  ATTACHMENT_UPLOAD: { label: '上传附件', tone: 'gray', group: '附件' },
  ATTACHMENT_DELETE: { label: '删除附件', tone: 'red', group: '附件' },
  BACKUP_CREATE: { label: '创建备份', tone: 'gray', group: '系统' },
  BACKUP_RESTORE: { label: '恢复备份', tone: 'amber', group: '系统' },
  BACKUP_DELETE: { label: '删除备份', tone: 'red', group: '系统' },
};

/** 「对象」列：服务端记的对象类型配中文名 */
const ENTITY_LABELS: Record<string, string> = {
  system: '系统', workflow: '业务登记', supplier: '供应商', procurementRequest: '申请', attachment: '附件', stock: '库存',
};
/** 筛选只列现在会记的动作；旧版本（旧台账等）的动作名只用来显示以前的记录 */
const actionOptions = computed(() =>
  Object.entries(ACTION_LABELS)
    .filter(([, meta]) => !meta.legacy)
    .map(([value, meta]) => ({ label: `${meta.group} · ${meta.label}`, value }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
);

onMounted(load);

function applyFilters(): void {
  filters.page = 1;
  void load();
}

/**
 * 详情原来是把 JSON 原样塞进单元格再 truncate，基本没法读。
 * 这里拆成键值对，字段名走旧台账字段（ITEM_FIELD_LABELS）的中文映射，展开才显示完整内容。
 */
interface DetailEntry {
  key: string;
  value: string;
  /** 来自 changed 的「旧值 → 新值」：摘要里不和同名的普通字段去重（补填流水号时要看得到「无OA-… → OA-…」） */
  change?: boolean;
}

function detailEntries(log: AuditRow): DetailEntry[] {
  if (!log.detail) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(log.detail);
  } catch {
    return [{ key: '详情', value: log.detail }];
  }
  if (parsed == null || typeof parsed !== 'object') return [{ key: '详情', value: String(parsed) }];

  const out: DetailEntry[] = [];
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (key === 'changes' && Array.isArray(value)) {
      for (const entry of value) {
        if (!entry || typeof entry !== 'object' || entry.before == null || entry.after == null) continue;
        if (typeof entry.before === 'string' && typeof entry.after === 'string') { out.push({ key: `物品 #${entry.productId}`, value: `${entry.before} → ${entry.after}`, change: true }); continue; }
        const label = (state: { paymentStatus: PaymentStatus; invoiceIssued: boolean }) => `${PAYMENT_STATUS_LABELS[state.paymentStatus] ?? state.paymentStatus} / ${state.invoiceIssued ? '已开票' : '未开票'}`;
        out.push({ key: `采购 #${entry.id}`, value: `${label(entry.before)} → ${label(entry.after)}`, change: true });
      }
      continue;
    }
    if (key === 'changed' && value && typeof value === 'object') {
      for (const [field, pair] of Object.entries(value as Record<string, [unknown, unknown]>)) {
        const [before, after] = Array.isArray(pair) ? pair : [undefined, pair];
        out.push({
          key: ITEM_FIELD_LABELS[field] ?? field,
          value: `${before ?? '空'} → ${after ?? '空'}`,
          change: true,
        });
      }
      continue;
    }
    out.push({
      key: DETAIL_KEY_LABELS[key] ?? ITEM_FIELD_LABELS[key] ?? key,
      // 数组里是对象时（库存核对的不一致明细）逐个转 JSON，不显示成 [object Object]
      value: Array.isArray(value)
        ? value.map((v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : String(v))).join('、')
        : typeof value === 'object'
          ? JSON.stringify(value)
          : String(value),
    });
  }
  return out;
}

const DETAIL_KEY_LABELS: Record<string, string> = {
  ids: '记录 ID',
  count: '条数',
  updated: '更新条数',
  restored: '恢复条数',
  purged: '删除条数',
  created: '新建条数',
  merged: '合并条数',
  skipped: '跳过条数',
  scope: '范围',
  patch: '修改内容',
  filename: '文件名',
  serialNumber: '流水号',
  kind: '类型',
  historyId: '历史版本',
  id: 'ID',
  operationId: '操作编号',
  input: '提交内容',
  taskId: '导入任务',
  lines: '明细行数',
  name: '文件名',
  mismatches: '不一致处数',
  sourceTaskId: '来源导入任务',
  previous: '原链接',
};

/**
 * 列表里给一行摘要，展开看全部。摘要会被截断，所以有用的字段排前面：流水号、文件名、明细行数优先
 * （业务登记的这两项在 input 里，提出来单列），提交内容的整段 JSON 与操作编号（UUID）放最后。
 */
const SUMMARY_FIRST = ['流水号', '文件名', '明细行数'];
const SUMMARY_LAST = ['提交内容', '操作编号'];
function liftedEntries(log: AuditRow): DetailEntry[] {
  let parsed: unknown;
  try {
    parsed = log.detail ? JSON.parse(log.detail) : null;
  } catch {
    return [];
  }
  const input = (parsed as { input?: unknown } | null)?.input;
  if (!input || typeof input !== 'object') return [];
  const out: DetailEntry[] = [];
  const { serialNumber, lines } = input as { serialNumber?: unknown; lines?: unknown };
  if (typeof serialNumber === 'string' && serialNumber) out.push({ key: '流水号', value: serialNumber });
  if (Array.isArray(lines)) out.push({ key: '明细行数', value: String(lines.length) });
  return out;
}
function summaryRank(key: string): number {
  if (SUMMARY_FIRST.includes(key)) return SUMMARY_FIRST.indexOf(key) - SUMMARY_FIRST.length;
  return SUMMARY_LAST.includes(key) ? 1 + SUMMARY_LAST.indexOf(key) : 0;
}
function detailSummary(log: AuditRow): string {
  const seen = new Set<string>();
  const entries = [...liftedEntries(log), ...detailEntries(log)]
    .filter((e) => {
      const id = e.change ? `${e.key}→` : e.key;
      return seen.has(id) ? false : (seen.add(id), true);
    })
    .map((e, index) => ({ ...e, index }))
    .sort((a, b) => summaryRank(a.key) - summaryRank(b.key) || a.index - b.index);
  if (entries.length === 0) return '—';
  return entries.map((e) => `${e.key}：${e.value}`).join(' · ');
}

function toggle(id: number): void {
  const next = new Set(expanded.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  expanded.value = next;
}

const hasFilters = computed(() => !!(filters.search || filters.action));
const actionLabel = computed(() => (filters.action ? (ACTION_LABELS[filters.action]?.label ?? filters.action) : ''));
/** 筛选无结果：标题复述条件 */
const noMatchTitle = computed(() =>
  filters.search ? `没有找到「${filters.search}」相关的记录` : `没有「${actionLabel.value}」的记录`,
);
const noMatchHint = computed(() =>
  filters.search && filters.action ? `当前筛选：${actionLabel.value}。试试放宽条件。` : '试试换个操作类型或关键词。',
);

function clearAll(): void {
  Object.assign(filters, DEFAULTS);
  void load();
}
function clearSearch(): void {
  filters.search = '';
  applyFilters();
}
</script>

<template>
  <!-- 工具栏 + 表格 + 分页在同一个贴边面板里，面板随内容增高（<main> 才是滚动容器）；宽度由 SettingsLayout 限制在 760px -->
  <Panel title="审计日志" description="登录、导入、业务登记、备份与设置变更都会留痕；点一行查看完整详情" flush>
    <template #toolbar>
      <SearchInput v-model="filters.search" class="w-full sm:w-72" placeholder="搜索详情内容" @search="applyFilters" />
      <NativeSelect
        v-model="filters.action"
        :options="actionOptions"
        placeholder="全部操作类型"
        class="min-w-0 flex-1 sm:flex-none sm:w-52"
        aria-label="按操作类型筛选"
        @update:model-value="applyFilters"
      />
      <Button v-if="hasFilters" variant="ghost" size="sm" @click="clearAll">
        <Icon name="close" :size="14" /> 清除
      </Button>
      <p class="ml-auto text-meta num">共 {{ total }} 条</p>
    </template>

    <div v-if="loading" class="p-4 space-y-2">
      <Skeleton v-for="i in 8" :key="i" class="h-10" />
    </div>
    <ErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <!-- 有筛选 = 无结果：复述条件并给出清除；没有筛选 = 还没有记录 -->
    <EmptyState v-else-if="logs.length === 0 && hasFilters" :icon="false" :title="noMatchTitle" :description="noMatchHint">
      <Button size="sm" @click="clearAll">清除全部条件</Button>
      <Button v-if="filters.search && filters.action" size="sm" variant="ghost" @click="clearSearch">只清除关键词</Button>
    </EmptyState>
    <EmptyState v-else-if="logs.length === 0" icon="audit" title="还没有审计记录" description="登录、导入、业务登记、备份与设置变更都会记在这里。" />

    <div v-else class="overflow-x-auto">
      <table class="table-base table-cards min-w-[700px]">
        <thead>
          <tr>
            <th scope="col" class="w-36">时间</th>
            <th scope="col" class="w-32">操作</th>
            <th scope="col" class="w-28">对象</th>
            <th scope="col">详情</th>
            <th scope="col" class="w-32">来源 IP</th>
          </tr>
        </thead>
        <tbody>
          <!--
            表格：顶对齐（展开后多行）；Badge 那格的上下留白由 td:has(.badge) 统一收到 10px，
            药丸与各列首行文字同一条中线，行高仍是 44px。
            手机卡片（< 640px）：tr 改成两列网格，时间 + 操作 Badge 并排作卡片头，对象 / 详情 / 来源 IP 各占一整行；
            整张卡片可点，展开后「详情」的键值对换到列名下方、占满卡片宽度（has-[dl]：展开且有内容时才换行）。
            整行可点是鼠标的捷径；键盘与读屏用详情格里的展开按钮（aria-expanded）。
          -->
          <tr
            v-for="log in logs"
            :key="log.id"
            class="cursor-pointer max-sm:grid max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:items-center max-sm:gap-x-3"
            :class="expanded.has(log.id) ? 'bg-surface-2' : ''"
            @click="toggle(log.id)"
          >
            <td class="align-top num whitespace-nowrap max-sm:font-medium max-sm:text-ink">{{ formatDateTime(log.createdAt, true) }}</td>
            <td class="align-top">
              <Badge :tone="ACTION_LABELS[log.action]?.tone ?? 'gray'">
                {{ ACTION_LABELS[log.action]?.label ?? log.action }}
              </Badge>
            </td>
            <td data-label="对象" class="align-top text-[13px] text-muted whitespace-nowrap num max-sm:col-span-2">
              {{ log.entity ? (ENTITY_LABELS[log.entity] ?? log.entity) : '—' }}<template v-if="log.entityId"> #{{ log.entityId }}</template>
            </td>
            <!-- sm:w-full sm:max-w-0：详情列吃掉剩余宽度、摘要按列宽截断（760px 的面板里其余列不被挤出视野） -->
            <td data-label="详情" class="align-top text-[13px] text-muted sm:w-full sm:max-w-0 max-sm:col-span-2 max-sm:has-[dl]:flex-wrap max-sm:has-[dl]:gap-y-1.5">
              <div class="flex min-w-0 items-start gap-2 max-sm:has-[dl]:basis-full max-sm:has-[dl]:text-left">
                <div class="min-w-0 flex-1">
                  <dl
                    v-if="expanded.has(log.id) && detailEntries(log).length > 0"
                    class="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1"
                  >
                    <template v-for="(e, i) in detailEntries(log)" :key="i">
                      <dt class="text-faint whitespace-nowrap">{{ e.key }}</dt>
                      <dd class="text-text break-all">{{ e.value }}</dd>
                    </template>
                  </dl>
                  <p v-else class="truncate">{{ detailSummary(log) }}</p>
                </div>
                <button
                  v-if="detailEntries(log).length > 0"
                  type="button"
                  class="-my-px flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-faint transition-colors duration-150 hover:text-ink"
                  :aria-expanded="expanded.has(log.id)"
                  :aria-label="expanded.has(log.id) ? '收起详情' : '展开详情'"
                  @click.stop="toggle(log.id)"
                >
                  <Icon
                    name="chevron-down"
                    :size="14"
                    class="transition-transform duration-150"
                    :class="expanded.has(log.id) ? 'rotate-180' : ''"
                  />
                </button>
              </div>
            </td>
            <!-- 等宽字体写在值上：卡片里的列名（td::before）会继承 td 的 font-family；卡片里长的 IPv6 可以折行 -->
            <td data-label="来源 IP" class="align-top max-sm:col-span-2">
              <span class="font-mono text-meta break-all sm:whitespace-nowrap">{{ log.operatorIp ?? '—' }}</span>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <template v-if="!loading && !loadError && logs.length > 0" #footer>
      <Pagination :page="filters.page" :page-size="pageSize" :total="total" @change="(p) => { filters.page = p; load(); }" />
    </template>
  </Panel>
</template>
