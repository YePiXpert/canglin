<script setup lang="ts">
import { computed } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import SettingRow from './SettingRow.vue';
import type { SystemStatus } from '@/api';
import { formatDateTime } from '@/utils/datetime';
import { formatBytes } from '@/utils/format';

const props = defineProps<{ status: SystemStatus | null; ocrOk: boolean | null; ocrChecking: boolean; refreshing?: boolean }>();
/** refresh：设置页重拉系统状态与 OCR 健康（不回填其它面板的表单）；recheckOcr：设置页重测 OCR 并提示结果 */
const emit = defineEmits<{ refresh: []; recheckOcr: [] }>();

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d} 天 ${h} 小时` : `${h} 小时`;
}

const description = computed(() =>
  props.status ? `仓廪 v${props.status.version} · 已运行 ${fmtUptime(props.status.uptimeSeconds)}` : undefined,
);

/** 四格数字：数量与数据库大小 */
const figures = computed(() => [
  { label: '申请单', value: String(props.status?.counts.requests ?? '—') },
  { label: '物品', value: String(props.status?.counts.products ?? '—') },
  { label: '有效单据（已过账）', value: String(props.status?.counts.documents ?? '—') },
  { label: '数据库', value: formatBytes(props.status?.dbSizeBytes ?? 0) },
]);
</script>

<template>
  <!-- 系统状态：版本与运行时长在标题说明里；四格数字；库存核对与 OCR 两行状态 -->
  <Panel :description="description" title="系统状态" flush>
    <template #actions>
      <Button variant="ghost" size="sm" class="-mr-2" :loading="refreshing" @click="emit('refresh')">
        <Icon v-if="!refreshing" name="refresh" :size="14" /> 刷新
      </Button>
    </template>
    <!-- gap-px + line 底色画出格子之间的发丝线 -->
    <dl class="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
      <div v-for="figure in figures" :key="figure.label" class="min-w-0 bg-surface px-5 py-3">
        <dt class="truncate text-xs text-muted">{{ figure.label }}</dt>
        <dd class="mt-0.5 text-[15px] leading-6 font-semibold text-ink num">{{ figure.value }}</dd>
      </div>
    </dl>
    <div class="divide-y divide-line border-t border-line">
      <SettingRow v-if="status?.stockCheck" label="库存核对" description="每天 03:00 自动核对库存余额与流水是否一致">
        <Badge v-if="!status.stockCheck.checkedAt" dot>尚未核对</Badge>
        <template v-else>
          <Badge :tone="status.stockCheck.mismatches > 0 ? 'red' : 'teal'" dot>
            {{ status.stockCheck.mismatches > 0 ? `${status.stockCheck.mismatches} 处不一致` : '正常' }}
          </Badge>
          <span class="text-meta num">{{ formatDateTime(status.stockCheck.checkedAt) }}</span>
        </template>
      </SettingRow>
      <SettingRow label="本地 OCR 服务" description="在本机识别导入原件的文字，AI 关闭或识别失败时使用">
        <Badge :tone="ocrOk ? 'teal' : 'red'" dot>{{ ocrOk ? '正常' : '不可用' }}</Badge>
        <Button variant="ghost" size="sm" class="-mr-2" :loading="ocrChecking" @click="emit('recheckOcr')">重新检测</Button>
      </SettingRow>
    </div>
    <div v-if="ocrOk === false" class="px-5 pb-4">
      <Notice size="sm">OCR 不可用时导入页仍能打开，但上传后会解析失败。可以先人工录入申请单。</Notice>
    </div>
  </Panel>
</template>
