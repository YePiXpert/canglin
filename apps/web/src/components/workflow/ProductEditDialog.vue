<script setup lang="ts">
import { computed, reactive, watch } from 'vue';
import { suggestProductDescription, workflowProductUpdateSchema, type WorkflowProductDetailsRow } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { issueText } from '@/utils/form';

const props = defineProps<{ open: boolean; product: WorkflowProductDetailsRow }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; saved: [product: WorkflowProductDetailsRow] }>();
const form = reactive({ itemName: '', specification: '', reason: '' });
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => JSON.stringify(form));
watch(() => props.open, open => {
  if (!open) return;
  Object.assign(form, { itemName: props.product.name, specification: props.product.specification, reason: '' }); reset();
}, { immediate: true });
const suggestion = computed(() => suggestProductDescription(form.itemName, form.specification, props.product.unit));
const canOrganize = computed(() => suggestion.value.itemName !== form.itemName || suggestion.value.specification !== form.specification);
function organize() { Object.assign(form, suggestion.value); }
async function save() {
  if (saving.value) return;
  errors.value = {};
  if (!form.itemName.trim()) errors.value.itemName = '请填写物品名称';
  if (!form.reason.trim()) errors.value.reason = '请填写修改原因';
  if (Object.keys(errors.value).length) return;
  const parsed = workflowProductUpdateSchema.safeParse({ ...form, version: props.product.version });
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  const updated = await submit(() => workflowApi.updateProduct(props.product.id, parsed.data));
  if (!updated) return;
  emit('update:open', false); emit('saved', updated);
}
</script>

<template>
  <Dialog :open="open" title="修改物品资料" :description="`物品 #${product.id} · 计量单位：${product.unit}`" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <Notice tone="blue" size="sm" class="mb-4">修改品名和规格后，库存沿用同一个物品编号；旧名称仍可搜索，历史单据保留登记时的名称。</Notice>
    <Input v-model="form.itemName" label="物品名称" hint="建议填写品牌、品类和必要型号，如：得力 7084 铅笔" required :disabled="saving" :error="errors.itemName" />
    <Input v-model="form.specification" label="规格" hint="颜色、尺寸、包装另写在这里，如：2B；12支/盒；墨绿" :disabled="saving" class="mt-4" />
    <div v-if="canOrganize" class="mt-3 rounded-lg border border-line p-3">
      <p class="text-xs font-medium">整理建议</p>
      <p class="mt-1 text-sm break-words">{{ suggestion.itemName }}</p>
      <p class="mt-1 text-meta break-words">规格：{{ suggestion.specification || '未填写' }}</p>
      <Button size="sm" class="mt-2" :disabled="saving" @click="organize">采用整理建议</Button>
    </div>
    <p class="mt-3 text-meta">计量单位固定为 {{ product.unit }}；不同单位应作为另一种物品登记。</p>
    <Input v-model="form.reason" label="修改原因" placeholder="如：清理商城杂字，把包装信息移到规格" required :disabled="saving" :error="errors.reason" class="mt-4" />
    <details v-if="product.aliases.length" class="mt-4 text-meta"><summary class="cursor-pointer">曾用名称（{{ product.aliases.length }}）</summary><ul class="mt-2 space-y-1"><li v-for="alias in product.aliases" :key="`${alias.name}:${alias.specification}`" class="break-words">{{ alias.name }}<template v-if="alias.specification"> · {{ alias.specification }}</template></li></ul></details>
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="w-full">{{ failure }}</Notice>
      <Button variant="ghost" :disabled="saving" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" @click="save">保存物品资料</Button>
    </template>
  </Dialog>
</template>
