<script setup lang="ts">
import { reactive, watch } from 'vue';
import { workflowProductCreateSchema } from '@canglin/shared';
import { workflowApi } from '@/api/workflow';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import Button from '@/components/ui/Button.vue';
import Notice from '@/components/ui/Notice.vue';
import { useDialogForm } from '@/composables/useDialogForm';
import { issueText } from '@/utils/form';
const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ 'update:open': [value: boolean]; created: [] }>();
const form = reactive({ itemName: '', specification: '', unit: '' });
/** 任一字段非空就算改动（干净时三项都是空串） */
const { saving, failure, errors, dirty, reset, submit } = useDialogForm(() => form.itemName + form.specification + form.unit);
watch(() => props.open, (open) => { if (open) { Object.assign(form, { itemName: '', specification: '', unit: '' }); reset(); } });
async function save() {
  errors.value = {};
  if (!form.itemName.trim()) errors.value.itemName = '请填写物品名称';
  if (!form.unit.trim()) errors.value.unit = '请填写固定计量单位';
  const parsed = workflowProductCreateSchema.safeParse(form);
  if (Object.keys(errors.value).length) return;
  if (!parsed.success) { failure.value = issueText(parsed.error); return; }
  // 清空字段放在 run 里：成功时记下的干净快照是清空之后的内容
  const created = await submit(async () => { const product = await workflowApi.createProduct(parsed.data); form.itemName = ''; form.specification = ''; form.unit = ''; return product; });
  if (created === undefined) return;
  emit('update:open', false); emit('created');
}
</script>
<template>
  <Dialog :open="open" title="新增库存物品" description="品名、规格与计量单位共同区分物品；创建后可登记盘点增加，申请到货入库会自动建立物品" :dirty="dirty && !saving" :persistent="saving" @update:open="emit('update:open', $event)">
    <Input v-model="form.itemName" label="物品名称" required :error="errors.itemName" :disabled="saving" />
    <div class="mt-4 grid gap-4 sm:grid-cols-2">
      <Input v-model="form.specification" label="规格" placeholder="如 A4 / 80g（可空）" :disabled="saving" />
      <Input v-model="form.unit" label="计量单位" placeholder="盒 / 支 / 包" required :error="errors.unit" :disabled="saving" />
    </div>
    <template #footer="{ close }">
      <Notice v-if="failure" tone="red" variant="inline" role="alert" class="mr-auto self-center max-sm:w-full">{{ failure }}</Notice>
      <Button variant="ghost" :disabled="saving" class="max-sm:h-11" @click="close">取消</Button>
      <Button variant="primary" :loading="saving" class="max-sm:h-11 max-sm:flex-1" @click="save">创建库存物品</Button>
    </template>
  </Dialog>
</template>
