<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { canonicalLink, isShortLink, isWebLink, linkSearches, workflowLinkUpdateSchema } from '@canglin/shared';
import { workflowApi, type WorkflowDocumentRow, type WorkflowRequestRow } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { buttonClass } from '@/components/ui/button';
import { useDialogForm } from '@/composables/useDialogForm';

/**
 * 更换 / 添加采购链接（docs/import-units-links-2026-10.md L7）：申请明细（申请里附的链接）与已登记采购单的明细共用。
 * 只改链接，不动数量与金额；审计日志记下旧链接。保存前按规范地址精简（显示「将保存为」），短链接提示换成商品页地址。
 * 链接打不开时给按品名搜索的入口：原链接是京东就去京东搜，天猫与淘宝去淘宝搜，认不出网站时两个都给。
 */
export interface LinkTarget {
  kind: 'request' | 'purchase';
  lineId: number;
  itemName: string;
  specification: string;
  purchaseLink: string | null;
  /** 弹窗说明里的来源：「申请 OA-1 第 2 行」「采购成交 #117」 */
  context: string;
}
const props = defineProps<{ open: boolean; target: LinkTarget }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [row: WorkflowRequestRow | WorkflowDocumentRow] }>();
const form = reactive({ link: '' });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => form.link);
watch(() => props.open, (open) => {
  if (!open) return;
  form.link = props.target.purchaseLink ?? '';
  reset();
}, { immediate: true });
const value = computed(() => form.link.trim());
const canonical = computed(() => (isWebLink(value.value) ? canonicalLink(value.value) : ''));
const searches = computed(() => linkSearches(props.target.purchaseLink, props.target.itemName, props.target.specification));
async function save() {
  errors.value = {};
  const parsed = workflowLinkUpdateSchema.safeParse({ purchaseLink: form.link });
  if (!parsed.success) {
    errors.value.link = parsed.error.issues[0]?.message ?? '链接无效';
    return;
  }
  const row = await submit<WorkflowRequestRow | WorkflowDocumentRow>(() => (props.target.kind === 'request'
    ? workflowApi.updateRequestLineLink(props.target.lineId, parsed.data)
    : workflowApi.updatePurchaseLineLink(props.target.lineId, parsed.data)));
  if (row === undefined) return;
  emit('update:open', false);
  emit('saved', row);
}
</script>

<template>
  <Dialog
    :open="open"
    :title="target.purchaseLink ? '更换采购链接' : '添加采购链接'"
    :description="`${target.context} · ${target.itemName}${target.specification ? ` · ${target.specification}` : ''}`"
    :dirty="dirty && !saving"
    :persistent="saving"
    @update:open="emit('update:open', $event)"
  >
    <Input v-model="form.link" label="采购链接" placeholder="https://…" hint="清空后保存就是去掉链接" :error="errors.link" :disabled="saving" @enter="save" />
    <p v-if="canonical && canonical !== value" class="mt-1.5 break-all text-meta">将保存为：{{ canonical }}</p>
    <Notice v-if="isShortLink(value)" tone="amber" variant="inline" size="sm" class="mt-2">短链接容易失效，建议打开后复制商品页地址再保存。</Notice>
    <div v-if="searches.length" class="mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line pt-3 text-[13px] text-muted">
      <span>原链接打不开？按品名搜同款：</span>
      <a v-for="search in searches" :key="search.url" :href="search.url" target="_blank" rel="noopener" :class="buttonClass({ variant: 'link' })">{{ search.label }}<Icon name="arrow-up-right" :size="13" /></a>
    </div>
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:w-full">{{ failure }}</Notice>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">保存链接</Button>
    </template>
  </Dialog>
</template>
