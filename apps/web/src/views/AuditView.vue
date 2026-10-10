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
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/datetime';
import { useUrlState } from '@/composables/useUrlState';
import { createRequestGuard } from '@/utils/request';
import { ITEM_FIELD_LABELS } from '@canglin/shared';

const toast = useToastStore();
const guard = createRequestGuard();

const DEFAULTS = { search: '', action: '', page: 1 };
const filters = reactive({ ...DEFAULTS });
useUrlState(filters, DEFAULTS);

const logs = ref<AuditRow[]>([]);
const total = ref(0);
const pageSize = 30;
const loading = ref(true);
const loadError = ref('');
const expanded = ref<Set<number>>(new Set());

/**
 * 操作类型按动作分色，颜色只说明「这是哪类动作」：
 * 登录 / 初始化 / 备份 gray · 新增与修改 blue · 删除 / 作废 / 失败 red ·
 * 导入 / 发放 / 入库 teal（品牌绿）· 恢复 / 回滚 / 改密这类覆盖性操作 amber 提醒。
 */
const ACTION_LABELS: Record<string, { label: string; tone: 'blue' | 'teal' | 'amber' | 'red' | 'gray'; group: string }> = {
  AUTH_SETUP: { label: '初始化', tone: 'gray', group: '账号' },
  AUTH_LOGIN: { label: '登录', tone: 'gray', group: '账号' },
  AUTH_LOGIN_FAILED: { label: '登录失败', tone: 'red', group: '账号' },
  AUTH_RECOVER: { label: '恢复密码', tone: 'amber', group: '账号' },
  AUTH_RECOVER_FAILED: { label: '恢复码错误', tone: 'red', group: '账号' },
  AUTH_CHANGE_PASSWORD: { label: '修改密码', tone: 'amber', group: '账号' },
  AUTH_REGENERATE_RECOVERY: { label: '重置恢复码', tone: 'amber', group: '账号' },
  // 旧版台账已删除，保留这些动作名只为显示历史审计记录
  ITEM_CREATE: { label: '新增台账', tone: 'blue', group: '旧台账' },
  ITEM_UPDATE: { label: '修改台账', tone: 'blue', group: '旧台账' },
  ITEM_BATCH_UPDATE: { label: '批量修改', tone: 'blue', group: '旧台账' },
  ITEM_PURCHASE: { label: '下单登记', tone: 'blue', group: '旧台账' },
  ITEM_DELETE: { label: '删除台账', tone: 'red', group: '旧台账' },
  ITEM_RESTORE: { label: '恢复台账', tone: 'blue', group: '旧台账' },
  ITEM_PURGE: { label: '彻底删除', tone: 'red', group: '旧台账' },
  ITEM_ROLLBACK: { label: '回滚', tone: 'amber', group: '旧台账' },
  ITEM_STOCK_IN: { label: '采购入库', tone: 'teal', group: '库存' },
  ITEM_STOCK_IN_BATCH: { label: '整单入库', tone: 'teal', group: '库存' },
  AI_CONFIG_UPDATE: { label: '修改 AI 设置', tone: 'blue', group: 'AI' },
  AI_QUERY: { label: 'AI 问答', tone: 'gray', group: 'AI' },
  AI_OCR_REVIEW: { label: 'AI 复核单据', tone: 'gray', group: 'AI' },
  DISTRIBUTION_CREATE: { label: '发放登记', tone: 'teal', group: '发放' },
  DISTRIBUTION_REVOKE: { label: '作废发放', tone: 'red', group: '发放' },
  IMPORT_UPLOAD: { label: '上传单据', tone: 'teal', group: '导入' },
  IMPORT_CONFIRM: { label: '确认导入', tone: 'teal', group: '导入' },
  PRODUCT_CREATE: { label: '新增物品', tone: 'blue', group: '库存' },
  PRODUCT_UPDATE: { label: '修改物品', tone: 'blue', group: '库存' },
  PRODUCT_DELETE: { label: '删除物品', tone: 'red', group: '库存' },
  INVENTORY_MOVEMENT: { label: '库存流水', tone: 'teal', group: '库存' },
  INVENTORY_MOVEMENT_DELETE: { label: '删流水', tone: 'red', group: '库存' },
  SUPPLIER_CREATE: { label: '新增供应商', tone: 'blue', group: '供应商' },
  SUPPLIER_UPDATE: { label: '修改供应商', tone: 'blue', group: '供应商' },
  SUPPLIER_DELETE: { label: '删除供应商', tone: 'red', group: '供应商' },
  PRICE_RECORD_CREATE: { label: '记价', tone: 'blue', group: '供应商' },
  PRICE_RECORD_DELETE: { label: '删价', tone: 'red', group: '供应商' },
  ATTACHMENT_UPLOAD: { label: '传附件', tone: 'blue', group: '附件' },
  ATTACHMENT_DELETE: { label: '删附件', tone: 'red', group: '附件' },
  BACKUP_CREATE: { label: '创建备份', tone: 'gray', group: '系统' },
  BACKUP_RESTORE: { label: '恢复备份', tone: 'amber', group: '系统' },
  BACKUP_DELETE: { label: '删备份', tone: 'red', group: '系统' },
};

const actionOptions = computed(() =>
  Object.entries(ACTION_LABELS)
    .map(([value, meta]) => ({ label: `${meta.group} · ${meta.label}`, value }))
    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN')),
);

async function load(silent = false): Promise<void> {
  const isCurrent = guard.begin();
  loading.value = logs.value.length === 0;
  try {
    const res = await auditApi.list({
      ...(filters.search ? { search: filters.search } : {}),
      ...(filters.action ? { action: filters.action } : {}),
      page: filters.page,
      pageSize,
    });
    if (!isCurrent()) return;
    logs.value = res.logs;
    total.value = res.total;
    loadError.value = '';
  } catch (e) {
    if (!isCurrent()) return;
    loadError.value = apiError(e);
    // 首次加载失败时页面上有 ErrorState，不必再弹 toast
    if (silent) toast.error(loadError.value);
  } finally {
    if (isCurrent()) loading.value = false;
  }
}
onMounted(load);

function applyFilters(): void {
  filters.page = 1;
  void load(true);
}

/**
 * 详情原来是把 JSON 原样塞进单元格再 truncate，基本没法读。
 * 这里拆成键值对，字段名走旧台账字段（ITEM_FIELD_LABELS）的中文映射，展开才显示完整内容。
 */
interface DetailEntry {
  key: string;
  value: string;
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
    if (key === 'changed' && value && typeof value === 'object') {
      for (const [field, pair] of Object.entries(value as Record<string, [unknown, unknown]>)) {
        const [before, after] = Array.isArray(pair) ? pair : [undefined, pair];
        out.push({
          key: ITEM_FIELD_LABELS[field] ?? field,
          value: `${before ?? '空'} → ${after ?? '空'}`,
        });
      }
      continue;
    }
    out.push({
      key: DETAIL_KEY_LABELS[key] ?? ITEM_FIELD_LABELS[key] ?? key,
      value: Array.isArray(value) ? value.join('、') : typeof value === 'object' ? JSON.stringify(value) : String(value),
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
};

/** 列表里给一行摘要，展开看全部 */
function detailSummary(log: AuditRow): string {
  const entries = detailEntries(log);
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
</script>

<template>
  <!-- 工具栏 + 表格 + 分页在同一个贴边面板里，面板随内容增高（<main> 才是滚动容器） -->
  <Panel flush>
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
      <Button v-if="hasFilters" variant="ghost" size="sm" @click="Object.assign(filters, DEFAULTS); load()">
        <Icon name="close" :size="14" /> 清除
      </Button>
      <p class="ml-auto text-meta num">共 {{ total }} 条</p>
    </template>

    <div v-if="loading" class="p-4 space-y-2">
      <Skeleton v-for="i in 8" :key="i" class="h-10" />
    </div>
    <ErrorState v-else-if="loadError" :message="loadError" @retry="load" />
    <EmptyState
      v-else-if="logs.length === 0"
      :illustration="hasFilters ? 'search' : 'empty'"
      :title="hasFilters ? '没有符合条件的记录' : '暂无审计记录'"
      :description="hasFilters ? '试试换个操作类型或关键词' : ''"
    />

    <div v-else class="overflow-x-auto">
      <table class="table-base table-cards min-w-[760px]">
        <thead>
          <tr>
            <th class="w-40">时间</th>
            <th class="w-28">操作</th>
            <th class="w-28">对象</th>
            <th>详情</th>
            <th class="w-32">来源 IP</th>
          </tr>
        </thead>
        <tbody>
          <!--
            表格：顶对齐（展开后多行）；Badge 那格的上下留白由 td:has(.badge) 统一收到 10px，
            药丸与各列首行文字同一条中线，行高仍是 44px。
            手机卡片（< 640px）：tr 改成两列网格，时间 + 操作 Badge 并排作卡片头，对象 / 详情 / 来源 IP 各占一整行；
            整张卡片可点，展开后「详情」的键值对换到列名下方、占满卡片宽度（has-[dl]：展开且有内容时才换行）。
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
              {{ log.entity ?? '—' }}<template v-if="log.entityId"> #{{ log.entityId }}</template>
            </td>
            <td data-label="详情" class="align-top text-[13px] text-muted max-sm:col-span-2 max-sm:has-[dl]:flex-wrap max-sm:has-[dl]:gap-y-1.5">
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
                  <p v-else class="truncate max-w-96">{{ detailSummary(log) }}</p>
                </div>
                <!-- 可展开的行给一个小箭头提示（整行可点，箭头只是视觉提示） -->
                <Icon
                  v-if="detailEntries(log).length > 0"
                  name="chevron-down"
                  :size="14"
                  class="mt-0.5 shrink-0 text-faint transition-transform duration-150"
                  :class="expanded.has(log.id) ? 'rotate-180' : ''"
                />
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
      <Pagination :page="filters.page" :page-size="pageSize" :total="total" @change="(p) => { filters.page = p; load(true); }" />
    </template>
  </Panel>
</template>
