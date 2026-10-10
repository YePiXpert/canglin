<script setup lang="ts">
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import type { SystemStatus } from '@/api';
import { formatDateTime } from '@/utils/datetime';
import { formatBytes } from '@/utils/format';

defineProps<{ status: SystemStatus | null; ocrOk: boolean | null; ocrChecking: boolean }>();
/** refresh：设置页重新 load()；recheckOcr：设置页重测 OCR 并提示结果 */
const emit = defineEmits<{ refresh: []; recheckOcr: [] }>();

function fmtUptime(sec: number): string {
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  return d > 0 ? `${d} 天 ${h} 小时` : `${h} 小时`;
}
</script>

<template>
  <!-- 系统状态 -->
  <Panel title="系统状态">
    <template #actions>
      <Button variant="ghost" size="sm" class="-mr-2" @click="emit('refresh')">
        <Icon name="refresh" :size="14" /> 刷新
      </Button>
    </template>
    <dl class="grid grid-cols-2 gap-x-6 gap-y-5 sm:grid-cols-3">
      <div>
        <dt class="text-xs text-faint">版本</dt>
        <dd class="mt-1 text-sm font-medium text-ink num">v{{ status?.version }}</dd>
      </div>
      <div>
        <dt class="text-xs text-faint">运行时长</dt>
        <dd class="mt-1 text-sm font-medium text-ink">{{ fmtUptime(status?.uptimeSeconds ?? 0) }}</dd>
      </div>
      <div>
        <dt class="text-xs text-faint">数据库大小</dt>
        <dd class="mt-1 text-sm font-medium text-ink num">{{ formatBytes(status?.dbSizeBytes ?? 0) }}</dd>
      </div>
      <div>
        <dt class="text-xs text-faint">OCR 解析服务</dt>
        <dd class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Badge :tone="ocrOk ? 'teal' : 'red'" dot>{{ ocrOk ? '正常' : '不可用' }}</Badge>
          <Button variant="link" class="text-xs" :disabled="ocrChecking" @click="emit('recheckOcr')">
            {{ ocrChecking ? '检测中…' : '重测' }}
          </Button>
        </dd>
      </div>
      <div>
        <dt class="text-xs text-faint">申请单</dt>
        <dd class="mt-1 text-sm font-medium text-ink num">{{ status?.counts.requests }}</dd>
      </div>
      <div>
        <dt class="text-xs text-faint">物品</dt>
        <dd class="mt-1 text-sm font-medium text-ink num">{{ status?.counts.products }}</dd>
      </div>
      <div>
        <dt class="text-xs text-faint">有效单据</dt>
        <dd class="mt-1 text-sm font-medium text-ink num">{{ status?.counts.documents }}</dd>
      </div>
      <div v-if="status?.stockCheck">
        <dt class="text-xs text-faint">库存核对</dt>
        <dd class="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1">
          <Badge v-if="!status.stockCheck.checkedAt" dot>尚未核对</Badge>
          <Badge v-else :tone="status.stockCheck.mismatches > 0 ? 'red' : 'teal'" dot>
            {{ status.stockCheck.mismatches > 0 ? `${status.stockCheck.mismatches} 处不一致` : '正常' }}
          </Badge>
          <span v-if="status.stockCheck.checkedAt" class="text-meta num">{{ formatDateTime(status.stockCheck.checkedAt) }}</span>
        </dd>
      </div>
    </dl>
    <Notice v-if="ocrOk === false" size="sm" class="mt-5">
      OCR 不可用时导入页仍能打开，但上传后会解析失败。可以先人工录入申请单。
    </Notice>
  </Panel>
</template>
