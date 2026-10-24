<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import type { ExceptionRow, ExceptionActionInput } from '@canglin/shared';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { useVisibleRefresh } from '@/components/planning/useVisibleRefresh';
import { exceptionTypeMeta, executionStatus, executionTone } from '@/components/execution/presentation';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Input from '@/components/ui/Input.vue';
import Select from '@/components/ui/Select.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Notice from '@/components/ui/Notice.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Pagination from '@/components/ui/Pagination.vue';
import ErrorState from '@/components/ui/ErrorState.vue';

const state = reactive({ search: '', status: 'ACTIVE', page: 1 });
useUrlState(state, { search: '', status: 'ACTIVE', page: 1 });

const list = useResource(() => executionApi.exceptions(state));
const rulesResource = useResource(executionApi.rules);
const { busy, failure, run } = usePlanningAction();
const target = ref<ExceptionRow>();
const action = ref<ExceptionActionInput['action']>('SNOOZE');
const reason = ref('');
const until = ref('');
const rulesOpen = ref(false);
const rules = reactive({ receivingDays: '7', draftDays: '14', stockIdleDays: '90' });
const historyKey = ref('');
const history = useResource(() => executionApi.exceptionHistory(historyKey.value));

function filter() {
  state.page = 1;
  void list.load();
}

function open(r: ExceptionRow, a: ExceptionActionInput['action']) {
  target.value = r;
  action.value = a;
  reason.value = '';
  until.value = '';
  failure.value = '';
}

async function submit() {
  if (!target.value) return;
  await run(async () => {
    await executionApi.exceptionAction({
      key: target.value!.key,
      version: target.value!.version,
      action: action.value,
      reason: reason.value,
      untilDate: action.value === 'SNOOZE' ? until.value : null,
    });
    target.value = undefined;
    await list.load();
  });
}

async function openRules() {
  failure.value = '';
  await rulesResource.load();
  if (rulesResource.data.value) {
    const r = rulesResource.data.value;
    Object.assign(rules, {
      receivingDays: String(r.receivingDays),
      draftDays: String(r.draftDays),
      stockIdleDays: String(r.stockIdleDays),
    });
    rulesOpen.value = true;
  }
}

async function saveRules() {
  await run(async () => {
    await executionApi.saveRules({
      receivingDays: Number(rules.receivingDays),
      draftDays: Number(rules.draftDays),
      stockIdleDays: Number(rules.stockIdleDays),
    });
    rulesOpen.value = false;
    await list.load();
  });
}

function accentBorderClass(type: string) {
  const tone = exceptionTypeMeta[type]?.tone;
  if (tone === 'red') return 'border-l-4 border-l-red';
  if (tone === 'amber') return 'border-l-4 border-l-amber';
  if (tone === 'blue') return 'border-l-4 border-l-blue';
  return 'border-l-4 border-l-line-strong';
}

onMounted(list.load);
useVisibleRefresh(() => {
  if (!busy.value && !target.value && !rulesOpen.value) return list.load();
});
</script>

<template>
  <div>
    <PageHeader
      title="异常中心"
      :description="`当前 ${list.data.value?.active ?? '—'} 项待处理，提醒随实际业务变化重新计算`"
    >
      <Button @click="openRules">提醒规则</Button>
    </PageHeader>
    <ExecutionLinks />

    <Notice v-if="failure && !target && !rulesOpen" tone="red" class="mb-4">{{ failure }}</Notice>
    <ErrorState v-if="rulesResource.error.value" :message="rulesResource.error.value" @retry="openRules" />

    <Panel title="需要留意的事项" flush>
      <template #toolbar>
        <Input v-model="state.search" label="搜索事项" @enter="filter" />
        <Select
          v-model="state.status"
          label="处理状态"
          :options="[
            { value: 'ACTIVE', label: '待处理' },
            { value: 'SNOOZED', label: '已暂缓' },
            { value: 'IGNORED', label: '已忽略' },
            { value: 'RESOLVED', label: '条件已解除' },
            { value: 'ALL', label: '全部' },
          ]"
          @update:model-value="filter"
        />
        <Button @click="filter">查询</Button>
      </template>

      <ErrorState v-if="list.error.value" :message="list.error.value" @retry="list.load" />
      <p v-if="list.loading.value" class="p-5 text-muted">正在核对业务状态…</p>
      <EmptyState
        v-else-if="!list.data.value?.items.length"
        icon="check"
        title="当前筛选下没有异常事项"
        description="所有收货、库存、票据及资金条件均在正常范围内。"
      />

      <div v-else class="divide-y divide-line">
        <article
          v-for="r in list.data.value?.items"
          :key="r.key"
          class="p-4 hover:bg-surface/50 transition-colors"
          :class="accentBorderClass(r.type)"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="inline-flex items-center gap-1 text-xs font-medium text-muted">
              <Icon :name="exceptionTypeMeta[r.type]?.icon ?? 'alert'" :size="14" />
              {{ exceptionTypeMeta[r.type]?.label ?? r.type }}
            </span>
            <p class="font-semibold">
              {{ r.title }}
              <span class="sr-only">{{ executionStatus[r.state] }}</span>
            </p>
            <Badge :tone="executionTone[r.state] ?? 'gray'">{{ executionStatus[r.state] }}</Badge>
          </div>

          <p class="text-sm mt-2" :data-waiting-days="['RECEIVING', 'DRAFT'].includes(r.type) ? '' : undefined">
            {{ r.detail }}
          </p>
          <p v-if="r.reason" class="text-meta mt-1">
            处理说明：{{ r.reason }}<span v-if="r.state === 'SNOOZED'"> · {{ r.untilDate }} 恢复提醒</span>
          </p>

          <div class="flex flex-wrap items-center gap-3 mt-3">
            <router-link v-if="r.state !== 'RESOLVED'" :to="r.url" class="underline text-sm font-medium text-accent">
              前往处理
            </router-link>
            <template v-if="r.state !== 'RESOLVED'">
              <Button v-if="r.state !== 'SNOOZED'" size="sm" @click="open(r, 'SNOOZE')">暂缓</Button>
              <Button v-if="r.state !== 'IGNORED'" size="sm" @click="open(r, 'IGNORE')">忽略</Button>
              <Button v-if="r.state !== 'ACTIVE'" size="sm" @click="open(r, 'RESUME')">恢复提醒</Button>
            </template>
            <Button size="sm" variant="ghost" @click="historyKey = r.key; history.load()">处理历史</Button>
          </div>
        </article>
      </div>

      <template #footer>
        <Pagination v-model:page="state.page" :total="list.data.value?.total" @change="list.load" />
      </template>
    </Panel>

    <Dialog
      :open="!!target"
      :title="action === 'SNOOZE' ? '暂缓提醒' : action === 'IGNORE' ? '忽略提醒' : '恢复提醒'"
      @update:open="target = undefined"
    >
      <p class="text-sm mb-4">{{ target?.title }}</p>
      <Notice class="mb-4">处理提醒不改变采购、库存或资金记录。条件解除后自动从待处理列表移除。</Notice>
      <Input v-if="action === 'SNOOZE'" v-model="until" type="date" label="恢复提醒日期" class="mb-4" />
      <Input v-model="reason" label="处理原因" />
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
      <template #footer>
        <Button
          variant="primary"
          :loading="busy"
          :disabled="!reason.trim() || (action === 'SNOOZE' && !until)"
          @click="submit"
        >
          保存处理记录
        </Button>
      </template>
    </Dialog>

    <Dialog v-model:open="rulesOpen" title="提醒规则">
      <div class="space-y-4">
        <Input v-model="rules.receivingDays" label="到货后未入库或发放提醒（天）" inputmode="numeric" />
        <Input v-model="rules.draftDays" label="未完成草稿提醒（天）" inputmode="numeric" />
        <Input v-model="rules.stockIdleDays" label="月报长期未领用库存（天）" inputmode="numeric" />
        <p class="text-meta">到货逾期按已登记的预计日期判断；补货按现有库存策略计算。未设置期限的到货不会判断为逾期。</p>
        <Notice v-if="failure" tone="red">{{ failure }}</Notice>
      </div>
      <template #footer>
        <Button variant="primary" :loading="busy" @click="saveRules">保存规则</Button>
      </template>
    </Dialog>

    <Dialog :open="!!historyKey" title="提醒处理历史" @update:open="historyKey = ''">
      <ErrorState v-if="history.error.value" :message="history.error.value" @retry="history.load" />
      <p v-if="!history.loading.value && !history.data.value?.length" class="text-muted">尚无人工处理记录。</p>
      <ol class="space-y-4">
        <li v-for="h in history.data.value" :key="h.id" class="border-l-2 border-line pl-3">
          <p class="text-sm font-medium">
            {{ h.action === 'SNOOZE' ? `暂缓至 ${h.untilDate}` : h.action === 'IGNORE' ? '忽略' : '恢复提醒' }} · {{ h.reason }}
          </p>
          <p class="text-meta mt-0.5">{{ new Date(h.createdAt).toLocaleString() }}</p>
        </li>
      </ol>
    </Dialog>
  </div>
</template>
