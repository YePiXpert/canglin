<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { executionApi } from '@/api/execution';
import { useResource } from '@/composables/useResource';
import { useUrlState } from '@/composables/useUrlState';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import { executionStatus, executionTone } from '@/components/execution/presentation';
import { todayString as today } from '@/utils/datetime';
import ExecutionLinks from '@/components/execution/ExecutionLinks.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Panel from '@/components/ui/Panel.vue';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import Tabs from '@/components/ui/Tabs.vue';
import Input from '@/components/ui/Input.vue';
import Checkbox from '@/components/ui/Checkbox.vue';
import Pagination from '@/components/ui/Pagination.vue';
import Dialog from '@/components/ui/Dialog.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Notice from '@/components/ui/Notice.vue';

const router = useRouter();
const { busy, failure, run } = usePlanningAction();
const state = reactive({ search: '', page: '1', tab: 'demands' });
useUrlState(state, { search: '', page: '1', tab: 'demands' });

const selected = ref<number[]>([]);
const creating = ref(false);
const ai = ref(false);
const prompt = ref('整理所选需求，按申请保留来源，生成本周集中采购草稿');
const form = reactive({ title: '', date: today(), note: '' });

const demands = useResource(() => executionApi.demands({ search: state.search, page: Number(state.page), pageSize: 30 }));
const batches = useResource(() => executionApi.batches({ search: state.search, page: Number(state.page), pageSize: 30 }));
const current = computed(() => (state.tab === 'demands' ? demands : batches));

const pageIds = computed(() => (demands.data.value?.items ?? []).map((d) => d.requestLineId));
const allPageSelected = computed(() => pageIds.value.length > 0 && pageIds.value.every((id) => selected.value.includes(id)));

function togglePage(checked: boolean) {
  if (checked) {
    const merged = new Set([...selected.value, ...pageIds.value]);
    selected.value = [...merged].slice(0, 200);
  } else {
    selected.value = selected.value.filter((id) => !pageIds.value.includes(id));
  }
}

async function load() {
  await current.value.load();
}
function filter() {
  selected.value = [];
  state.page = '1';
  void load();
}
function switchTab(value: string) {
  state.tab = value;
  filter();
}
function changePage(p: number) {
  state.page = String(p);
  void load();
}
function openCreate() {
  failure.value = '';
  form.title = '集中采购';
  creating.value = true;
}
function openAi() {
  failure.value = '';
  ai.value = true;
}
async function create() {
  if (
    await run(async () => {
      const b = await executionApi.createBatch({ ...form, requestLineIds: selected.value });
      creating.value = false;
      await router.push(`/procurement/batches/${b.id}`);
    }, '采购批次草稿已创建')
  )
    creating.value = false;
}
async function propose() {
  await run(async () => {
    const d = await executionApi.propose({
      kind: 'PURCHASE_BATCH',
      prompt: prompt.value,
      requestLineIds: selected.value,
      documentIds: [],
    });
    ai.value = false;
    await router.push(`/operations/drafts/${d.id}`);
  }, 'AI 建议已保存为可编辑草稿');
}
onMounted(load);
</script>

<template>
  <div>
    <PageHeader title="集中采购" description="汇总多张申请的剩余需求，按供应商安排本次下单；每行保留申请来源" />
    <ExecutionLinks />

    <div class="mb-5">
      <Tabs
        :model-value="state.tab"
        :tabs="[
          { value: 'demands', label: '待采购需求', icon: 'layers', count: demands.data.value?.total },
          { value: 'batches', label: '采购批次', icon: 'clipboard', count: batches.data.value?.total },
        ]"
        aria-label="集中采购视图切换"
        @update:model-value="switchTab"
      />
    </div>

    <Notice v-if="failure && !creating && !ai" tone="red" class="mb-4">{{ failure }}</Notice>

    <Panel
      :title="state.tab === 'demands' ? '待采购需求池' : '采购批次账册'"
      :description="state.tab === 'demands' ? '勾选多张申请的待采购明细，合并建立采购批次或交由 AI 归拢' : '按批次跟进供应商分拣、下单确认与后续到货状态'"
      flush
    >
      <template #toolbar>
        <Checkbox
          v-if="state.tab === 'demands' && pageIds.length"
          :checked="allPageSelected"
          :indeterminate="selected.some((id) => pageIds.includes(id)) && !allPageSelected"
          label="全选本页"
          @update:model-value="togglePage($event === true)"
        />
        <Input
          v-model="state.search"
          label="搜索"
          hide-label
          placeholder="物品、申请、部门或批次标题"
          class="w-full sm:w-64"
          @enter="filter"
        />
        <Button @click="filter">查询</Button>
        <template v-if="state.tab === 'demands'">
          <Button variant="primary" :disabled="!selected.length" @click="openCreate">
            建立采购批次（{{ selected.length }}）
          </Button>
          <Button :disabled="!selected.length" @click="openAi">
            <Icon name="sparkles" :size="14" />
            AI 整理所选需求
          </Button>
          <Button v-if="selected.length" variant="ghost" @click="selected = []">清空已选</Button>
        </template>
      </template>

      <ErrorState v-if="current.error.value" :message="current.error.value" @retry="load" />
      <p v-else-if="current.loading.value" class="p-5 text-muted">正在读取…</p>
      <EmptyState
        v-else-if="!current.data.value?.items.length"
        title="当前没有匹配记录"
        description="待采购申请会出现在需求池；批次草稿会保留在采购批次中。"
      />

      <div v-else-if="state.tab === 'demands'" class="divide-y divide-line">
        <article
          v-for="d in demands.data.value?.items"
          :key="d.requestLineId"
          class="flex items-start gap-3.5 px-4 py-3.5 transition-colors duration-100 hover:bg-surface-2/40"
          :class="selected.includes(d.requestLineId) ? 'bg-primary-soft/60' : ''"
        >
          <Checkbox
            v-model="selected"
            :value="d.requestLineId"
            :disabled="!selected.includes(d.requestLineId) && selected.length >= 200"
            :aria-label="`选择 ${d.itemName}`"
            class="mt-0.5"
          />
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-ink">{{ d.itemName }}</p>
              <Badge v-if="d.specification" tone="gray">{{ d.specification }}</Badge>
              <Badge v-for="id in d.draftBatchIds" :key="id" tone="amber">
                <router-link :to="`/procurement/batches/${id}`" class="underline">草稿批次 #{{ id }}</router-link>
              </Badge>
            </div>
            <p class="mt-1 text-meta flex flex-wrap items-center gap-x-2 gap-y-1">
              <router-link :to="`/requests/${d.requestId}`" class="font-mono font-medium text-blue hover:underline">
                {{ d.serialNumber }}
              </router-link>
              <span>· {{ d.department }}</span>
              <span>· 经办 {{ d.handler }}</span>
              <span>· 申请于 {{ d.requestDate }}</span>
            </p>
          </div>
          <div class="shrink-0 text-right">
            <span class="text-xs text-muted block">待采购</span>
            <strong class="num text-base font-semibold text-ink">{{ d.remaining }} {{ d.unit }}</strong>
          </div>
        </article>
      </div>

      <div v-else class="divide-y divide-line">
        <router-link
          v-for="b in batches.data.value?.items"
          :key="b.id"
          :to="`/procurement/batches/${b.id}`"
          class="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 transition-colors duration-100 hover:bg-surface-2/40"
        >
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2">
              <p class="font-semibold text-ink">{{ b.title }}</p>
              <span class="font-mono text-xs text-muted">#{{ b.id }}</span>
              <Badge :tone="executionTone[b.status]" dot>{{ executionStatus[b.status] }}</Badge>
            </div>
            <p class="mt-1 text-meta">计划采购日 {{ b.date }} · 包含 {{ b._count.lines }} 行需求明细</p>
          </div>
          <div class="flex items-center gap-3 text-sm">
            <Badge :tone="b._count.documents ? 'teal' : 'gray'">
              {{ b._count.documents ? `已生单 ${b._count.documents} 张` : '待确认生单' }}
            </Badge>
            <Icon name="chevron-right" :size="16" class="text-faint" />
          </div>
        </router-link>
      </div>

      <template #footer>
        <Pagination
          :page="Number(state.page)"
          :page-size="30"
          :total="current.data.value?.total ?? 0"
          @change="changePage"
        />
      </template>
    </Panel>

    <Dialog :open="creating" title="建立采购批次" @update:open="creating = $event">
      <div class="space-y-4">
        <Input v-model="form.title" label="批次标题" />
        <Input v-model="form.date" type="date" label="计划采购日期" />
        <Input v-model="form.note" label="备注" />
        <p class="text-meta">
          已选 {{ selected.length }} 条需求（包含其他页），将保存这些需求的当前待采购数量，随后可拆分供应商、调整数量和价格。
        </p>
        <Notice v-if="failure" tone="red">{{ failure }}</Notice>
      </div>
      <template #footer>
        <Button variant="primary" :loading="busy" @click="create">建立草稿</Button>
      </template>
    </Dialog>

    <Dialog :open="ai" title="AI 整理采购需求" @update:open="ai = $event">
      <Input v-model="prompt" label="整理要求" />
      <p class="mt-3 text-meta">把所选需求交给已配置的 AI 服务生成建议，保存后可以修改和核对。</p>
      <Notice v-if="failure" tone="red" class="mt-3">{{ failure }}</Notice>
      <template #footer>
        <Button variant="primary" :loading="busy" @click="propose">生成操作草稿</Button>
      </template>
    </Dialog>
  </div>
</template>
