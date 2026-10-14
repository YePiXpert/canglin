<script setup lang="ts">
import { ref } from 'vue';
import { ATTACHMENT_KIND_LABELS, type AttachmentKind, type WorkflowAttachment } from '@canglin/shared';
import { attachmentsApi, apiError } from '@/api';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { buttonClass } from '@/components/ui/button';

/**
 * 原件与单据附件：一个文件一行（纸样图标 + 文件名链接 + 类型），OA 原件不能删。
 * 默认是弹窗里的一个分组（上方发丝线隔开表单；是弹窗唯一内容时不画）；sheet = 放在面板里（申请详情的「OA 原件与附件」）：
 * 顶部一行计数与「上传附件」，行与行之间发丝线，贴面板边距。sheet 只影响外观。
 */
const props = defineProps<{
  documentId?: number;
  requestId?: number;
  kind?: 'INVOICE' | 'SIGNOFF';
  attachments: WorkflowAttachment[];
  sheet?: boolean;
}>();
const emit = defineEmits<{ changed: [] }>();
const picker = ref<HTMLInputElement>();
const uploading = ref(false);
const removing = ref<number>();
/** 等待确认删除的附件：垃圾桶只打开确认框，确认后才删除 */
const removeTarget = ref<WorkflowAttachment | null>(null);
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
async function remove() {
  const target = removeTarget.value;
  if (!target || removing.value) return;
  removing.value = target.id;
  failure.value = '';
  try { await attachmentsApi.remove(target.id); removeTarget.value = null; emit('changed'); }
  catch (cause) { removeTarget.value = null; failure.value = apiError(cause); }
  finally { removing.value = undefined; }
}
/* 纸样图标上的扩展名（PDF / PNG / JPG）与类型名（OA 原件 / 发票 / 签收单） */
function extension(filename: string) { return /\.([a-z0-9]{1,4})$/i.exec(filename)?.[1].toUpperCase() ?? '文件'; }
function kindLabel(kind: string) { return ATTACHMENT_KIND_LABELS[kind as AttachmentKind] ?? '附件'; }
</script>

<template>
  <section :class="sheet ? '' : 'mt-5 border-t border-line pt-4 first:mt-0 first:border-t-0 first:pt-0'" aria-label="单据附件">
    <p class="sr-only" role="status">{{ uploading ? '正在上传附件…' : '' }}</p>
    <div class="flex items-center justify-between gap-3" :class="sheet ? 'border-b border-line py-2 pr-2 pl-4' : ''">
      <div class="flex min-w-0 items-baseline gap-1.5"><h3 class="text-[13px] font-medium text-ink">{{ requestId ? '申请原件' : kind === 'SIGNOFF' ? '签收凭证' : '发票附件' }}</h3><span v-if="attachments.length" class="text-meta num">{{ attachments.length }} 份</span></div>
      <Button size="sm" :variant="sheet ? 'ghost' : 'secondary'" :loading="uploading" @click="picker?.click()"><Icon v-if="!uploading" name="upload" :size="14" />上传附件</Button>
      <input ref="picker" type="file" class="hidden" accept=".pdf,.png,.jpg,.jpeg" multiple aria-label="选择单据附件" @change="upload" />
    </div>
    <p v-if="!attachments.length" class="text-xs text-muted" :class="sheet ? 'px-4 py-3' : 'mt-3'">可上传 PDF、截图或照片。</p>
    <ul v-else class="divide-y divide-line" :class="sheet ? '' : 'mt-2'">
      <li v-for="attachment in attachments" :key="attachment.id" class="flex min-w-0 items-center gap-3" :class="sheet ? 'px-4 py-3' : 'py-2.5'">
        <span class="flex h-10 w-8 shrink-0 items-end justify-center rounded-[3px] border border-line-strong bg-surface pb-1 text-[9px] leading-none font-semibold text-faint" aria-hidden="true">{{ extension(attachment.filename) }}</span>
        <div class="min-w-0 flex-1">
          <a :href="`/api/attachments/${attachment.id}/download`" class="max-w-full text-[13px] font-medium" :class="buttonClass({ variant: 'link' })" target="_blank" rel="noopener"><span class="truncate">{{ attachment.filename }}</span></a>
          <p class="text-meta">{{ kindLabel(attachment.kind) }}</p>
        </div>
        <Button v-if="attachment.kind !== 'OA_DOC'" size="sm" variant="ghost" icon-only :loading="removing === attachment.id" :aria-label="`删除附件 ${attachment.filename}`" @click="removeTarget = attachment"><Icon v-if="removing !== attachment.id" name="trash" :size="14" /></Button>
      </li>
    </ul>
    <Notice v-if="failure" tone="red" variant="inline" size="sm" role="alert" :class="sheet ? 'border-t border-line px-4 py-2.5' : 'mt-3'">{{ failure }}</Notice>
    <ConfirmDialog
      :open="!!removeTarget"
      title="删除附件"
      :message="`「${removeTarget?.filename ?? ''}」将从${requestId ? '这张申请' : '这条业务记录'}中删除，文件不会保留，删除后不能恢复。`"
      confirm-text="删除"
      danger
      :loading="removing !== undefined"
      @update:open="removeTarget = null"
      @confirm="remove"
    />
  </section>
</template>
