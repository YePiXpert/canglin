<script setup lang="ts">
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import type { WorkflowRequestRow } from '@/api/workflow';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import { buttonClass } from '@/components/ui/button';
import type { MenuItem } from '@/components/ui/types';
import { quantityLabel } from './presentation';
import { lineQuantities, lineTitle, nextStep, progressChips } from './requestSummary';

/**
 * 申请单列表的一行（RequestCollection 的 table-base table-cards 里用）：
 * 流水号 | 部门 / 经办人 | 申请日期 | 申请明细（前两项，单行截断 + title）| 进度 chips | 下一步 +「…」。
 * 桌面各格顶对齐；手机（< 640px）是卡片：流水号与明细排在最前，chips 与操作在底部。
 * 下一步与「查看申请详情」都进申请详情办理；「…」里另有查看原件（新标签页打开附件）。
 */
const props = defineProps<{ request: WorkflowRequestRow }>();
const router = useRouter();

const to = computed(() => `/requests/${props.request.id}`);
const chips = computed(() => progressChips(props.request.lines));
const next = computed(() => nextStep(props.request.lines));
const first = computed(() => props.request.lines[0]);
const rest = computed(() => props.request.lines.slice(1));
const originals = computed(() => (props.request.attachments.length ? `${props.request.attachments.length} 份原件` : '无原件'));
const menuItems = computed<MenuItem[]>(() => [
  { label: '查看申请详情', icon: 'arrow-right', onSelect: () => void router.push(to.value) },
  ...props.request.attachments.map((file, index, all): MenuItem => ({
    label: all.length > 1 ? `查看原件 ${index + 1}` : '查看原件',
    icon: 'file',
    onSelect: () => { window.open(`/api/attachments/${file.id}/download`, '_blank', 'noopener'); },
  })),
]);
</script>

<template>
  <tr :data-request-id="request.id" class="sm:[&>td]:align-top">
    <td class="card-title">
      <router-link :to="to" class="break-words font-mono text-[12.5px] font-medium text-ink underline-offset-[3px] hover:underline">{{ request.serialNumber }}</router-link>
      <p class="mt-0.5 text-meta">{{ request.lines.length }} 条明细 · {{ originals }}</p>
    </td>
    <td data-label="部门 / 经办人">
      <div>{{ request.department }}<span class="text-meta max-sm:ml-1.5 sm:block">{{ request.handler }}</span></div>
    </td>
    <td data-label="申请日期" class="num">{{ request.requestDate }}</td>
    <!-- 表格里是剩余宽度（表格 table-fixed）、单行截断（悬停看全名）；卡片里整行显示、长品名折行 -->
    <td class="max-sm:-order-1">
      <template v-if="first">
        <!-- 多条明细：每条都是独立物品（墨色主字 + 序号角标 + 申请数量），避免第 2 条看起来像第 1 条的备注说明 -->
        <div v-if="rest.length" class="space-y-1.5">
          <p class="flex items-baseline gap-1.5" :title="lineTitle(first)">
            <span class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-surface-2 px-1 font-mono text-[11px] font-medium text-muted">1</span>
            <span class="min-w-0 sm:truncate">
              <span class="text-ink">{{ first.itemName }}</span><span v-if="first.specification" class="ml-1.5 text-xs text-muted">{{ first.specification }}</span>
            </span>
            <span class="ml-auto shrink-0 pl-2 text-xs text-muted num">× {{ quantityLabel(first.quantity, first.unit) }}</span>
          </p>
          <p class="flex items-baseline gap-1.5" :title="rest.map(lineTitle).join('\n')">
            <span class="inline-flex h-4 min-w-4 shrink-0 items-center justify-center rounded bg-surface-2 px-1 font-mono text-[11px] font-medium text-muted">2</span>
            <span class="min-w-0 sm:truncate">
              <span class="text-ink">{{ rest[0].itemName }}</span><span v-if="rest[0].specification" class="ml-1.5 text-xs text-muted">{{ rest[0].specification }}</span>
            </span>
            <span class="ml-auto shrink-0 pl-2 text-xs text-muted num">
              × {{ quantityLabel(rest[0].quantity, rest[0].unit) }}
              <span v-if="rest.length > 1" class="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-muted">等 {{ rest.length }} 项</span>
            </span>
          </p>
        </div>
        <!-- 单条明细：第 1 行物品名，第 2 行带左侧竖线缩进展示数量流转进度 -->
        <template v-else>
          <p class="sm:truncate" :title="lineTitle(first)">
            <span class="text-ink">{{ first.itemName }}</span><span v-if="first.specification" class="ml-1.5 text-xs text-muted">{{ first.specification }}</span>
          </p>
          <p class="mt-1 border-l-2 border-line-strong pl-2 text-meta num sm:truncate" :title="lineQuantities(first)">{{ lineQuantities(first) }}</p>
        </template>
      </template>
    </td>
    <td>
      <div class="flex flex-wrap gap-1">
        <Badge v-for="chip in chips" :key="chip.key" :tone="chip.tone" :class="{ 'line-through': chip.struck }" :title="chip.detail">{{ chip.label }}</Badge>
      </div>
    </td>
    <!-- 上下留白由 td:has(.row-action) 统一给（桌面 8px、触屏 2px）：28px 的按钮与左边第一行文字居中对齐 -->
    <td class="card-actions sm:text-right">
      <div class="inline-flex items-center gap-1">
        <router-link :to="to" :class="[buttonClass({ variant: next.variant, size: 'sm' }), 'max-sm:h-10 max-sm:px-3.5']" :aria-label="`${next.label} ${request.serialNumber}`">{{ next.label }}</router-link>
        <Menu :items="menuItems">
          <template #trigger>
            <button type="button" class="row-action data-[state=open]:bg-surface-2 data-[state=open]:text-ink data-[state=open]:opacity-100" :aria-label="`更多操作 ${request.serialNumber}`">
              <Icon name="more-horizontal" :size="16" />
            </button>
          </template>
        </Menu>
      </div>
    </td>
  </tr>
</template>
