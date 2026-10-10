<script setup lang="ts">
import { ref } from 'vue';
import type { WorkflowAttachment } from '@canglin/shared';
import { attachmentsApi, apiError } from '@/api';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';

const props = defineProps<{
  documentId?: number;
  requestId?: number;
  kind?: 'INVOICE' | 'SIGNOFF';
  attachments: WorkflowAttachment[];
}>();
const emit = defineEmits<{ changed: [] }>();
const picker = ref<HTMLInputElement>();
const uploading = ref(false);
const removing = ref<number>();
const failure = ref('');
async function upload(event: Event) {
  const input = event.target as HTMLInputElement;
  const files = [...(input.files ?? [])];
  input.value = '';
  if (!files.length || uploading.value) return;
  uploading.value = true;
  failure.value = '';
  try {
    for (const file of files) {
      if (props.requestId) await attachmentsApi.uploadForRequest(props.requestId, file);
      else if (props.documentId) await attachmentsApi.uploadForDocument(props.documentId, file, props.kind ?? 'INVOICE');
      else throw new Error('附件尚未关联单据');
      emit('changed');
    }
  } catch (cause) { failure.value = apiError(cause); }
  finally { uploading.value = false; }
}
async function remove(id: number) {
  if (removing.value) return;
  removing.value = id;
  failure.value = '';
  try { await attachmentsApi.remove(id); emit('changed'); }
  catch (cause) { failure.value = apiError(cause); }
  finally { removing.value = undefined; }
}
</script>

<template>
  <section class="mt-5 border-t border-line pt-4" aria-label="单据附件">
    <div class="flex items-center justify-between gap-3">
      <h3 class="text-[13px] font-medium text-ink">{{ requestId ? '申请原件' : kind === 'SIGNOFF' ? '签收凭证' : '发票附件' }}</h3>
      <Button size="sm" variant="secondary" :loading="uploading" @click="picker?.click()"><Icon name="upload" :size="14" />上传附件</Button>
      <input ref="picker" type="file" class="hidden" accept=".pdf,.png,.jpg,.jpeg" multiple aria-label="选择单据附件" @change="upload" />
    </div>
    <p v-if="!attachments.length" class="mt-3 text-xs text-muted">可上传 PDF、截图或照片。</p>
    <ul v-else class="mt-3 space-y-2">
      <li v-for="attachment in attachments" :key="attachment.id" class="flex min-w-0 items-center gap-2 text-[13px]">
        <Icon name="file" :size="14" class="shrink-0 text-muted" />
        <a :href="`/api/attachments/${attachment.id}/download`" class="min-w-0 flex-1 truncate text-blue hover:underline" target="_blank" rel="noopener">{{ attachment.filename }}</a>
        <Button v-if="attachment.kind !== 'OA_DOC'" size="sm" variant="ghost" :loading="removing === attachment.id" :aria-label="`删除附件 ${attachment.filename}`" @click="remove(attachment.id)"><Icon name="trash" :size="14" /></Button>
      </li>
    </ul>
    <Notice v-if="failure" tone="red" variant="inline" size="sm" role="alert" class="mt-3">{{ failure }}</Notice>
  </section>
</template>
