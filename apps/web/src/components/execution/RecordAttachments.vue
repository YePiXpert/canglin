<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { http } from '@/api/client';
import { downloadFile } from '@/api';
import { useResource } from '@/composables/useResource';
import { usePlanningAction } from '@/components/planning/usePlanningAction';
import Button from '@/components/ui/Button.vue';
import Badge from '@/components/ui/Badge.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';

const props = defineProps<{
  owner: 'invoices' | 'financial-records' | 'documents';
  id: number;
  kind?: 'INVOICE' | 'PAYMENT' | 'DELIVERY' | 'SIGNOFF';
  editable?: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();
const removing = ref<number>();
const previewId = ref<number>();
const picker = ref<HTMLInputElement>();
const { busy, failure, run } = usePlanningAction();

interface AttachmentItem {
  id: number;
  filename: string;
  mimeType?: string;
  sizeBytes: number;
}

const list = useResource(() =>
  http
    .get<AttachmentItem[]>('/attachments', {
      params: {
        [props.owner === 'invoices'
          ? 'invoiceRecordId'
          : props.owner === 'financial-records'
            ? 'financialRecordId'
            : 'businessDocumentId']: props.id,
      },
    })
    .then((r) => r.data),
);

watch(
  () => [props.owner, props.id],
  () => {
    previewId.value = undefined;
    void list.load();
  },
  { immediate: true },
);

const previewItem = computed(() => {
  const items = list.data.value ?? [];
  if (!items.length) return undefined;
  return items.find((a) => a.id === previewId.value) ?? items[0];
});

const isImage = (filename: string) => /\.(png|jpe?g)$/i.test(filename);
const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`);

async function upload(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  await run(async () => {
    const data = new FormData();
    data.append('file', file);
    await http.post(`/attachments/${props.owner}/${props.id}`, data, {
      params: props.owner === 'documents' ? { kind: props.kind ?? 'SIGNOFF' } : {},
    });
    input.value = '';
    await list.load();
    emit('changed');
  }, '凭证已保存');
}

async function remove() {
  if (!removing.value) return;
  await run(async () => {
    await http.delete(`/attachments/${removing.value}`);
    removing.value = undefined;
    await list.load();
    emit('changed');
  }, '已移除草稿原件');
}
</script>

<template>
  <div class="space-y-3">
    <div class="flex flex-wrap items-center justify-between gap-2">
      <div class="flex items-center gap-2">
        <Icon name="file" :size="15" class="text-muted" />
        <p class="font-semibold text-sm text-ink">原件与凭证</p>
        <Badge v-if="list.data.value?.length" tone="teal">{{ list.data.value.length }} 份</Badge>
      </div>
      <template v-if="editable !== false">
        <input
          ref="picker"
          class="hidden"
          type="file"
          accept=".pdf,.png,.jpg,.jpeg"
          aria-label="选择凭证文件"
          @change="upload"
        />
        <Button size="sm" :loading="busy" @click="picker?.click()">
          <Icon name="upload" :size="14" />
          上传 PDF 或照片
        </Button>
      </template>
    </div>

    <Notice v-if="failure" tone="red">{{ failure }}</Notice>
    <ErrorState v-if="list.error.value" :message="list.error.value" @retry="list.load" />

    <ul v-if="list.data.value?.length" class="divide-y divide-line rounded-md border border-line bg-surface-2/40">
      <li
        v-for="a in list.data.value"
        :key="a.id"
        class="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm"
      >
        <div class="flex min-w-0 items-center gap-2">
          <Icon :name="isImage(a.filename) ? 'image' : 'file'" :size="15" class="shrink-0 text-muted" />
          <button
            type="button"
            class="cursor-pointer underline text-sm font-medium text-ink break-all text-left hover:text-blue"
            @click="run(() => downloadFile(`/attachments/${a.id}/download`, a.filename), '')"
          >
            {{ a.filename }}
          </button>
          <span class="text-meta shrink-0">{{ formatSize(a.sizeBytes) }}</span>
        </div>
        <div class="flex items-center gap-1.5">
          <Button
            v-if="owner === 'invoices'"
            size="sm"
            variant="ghost"
            @click="previewId = previewId === a.id ? undefined : a.id"
          >
            {{ previewItem?.id === a.id && previewId !== undefined ? '收起预览' : '预览' }}
          </Button>
          <Button
            v-if="owner === 'invoices' && editable !== false"
            size="sm"
            variant="ghost"
            :disabled="busy"
            @click="removing = a.id"
          >
            移除
          </Button>
        </div>
      </li>
    </ul>
    <div
      v-else-if="!list.loading.value"
      class="rounded-md border border-dashed border-line-strong bg-surface-2/30 px-4 py-5 text-center"
    >
      <p class="text-meta">尚未上传原件。请上传 PDF 或照片凭证以供核对。</p>
    </div>

    <div
      v-if="owner === 'invoices' && previewItem && previewId !== undefined"
      class="overflow-hidden rounded-md border border-line bg-paper p-2"
    >
      <img
        v-if="isImage(previewItem.filename)"
        :src="`/api/attachments/${previewItem.id}/download`"
        :alt="previewItem.filename"
        class="mx-auto max-h-96 object-contain"
      />
      <iframe
        v-else
        :src="`/api/attachments/${previewItem.id}/download`"
        :title="previewItem.filename"
        class="h-96 w-full rounded border-0 bg-paper"
      />
    </div>

    <ConfirmDialog
      :open="!!removing"
      title="移除草稿原件"
      message="将从当前待核对发票移除这个文件，请重新上传正确原件。"
      :loading="busy"
      danger
      @confirm="remove"
      @update:open="removing = undefined"
    >
      <Notice v-if="failure" tone="red">{{ failure }}</Notice>
    </ConfirmDialog>
  </div>
</template>
