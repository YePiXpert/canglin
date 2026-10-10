<script setup lang="ts">
import { inject } from 'vue';
import Button from '@/components/ui/Button.vue';
import FileDropzone from '@/components/ui/FileDropzone.vue';
import Icon from '@/components/ui/Icon.vue';
import Notice from '@/components/ui/Notice.vue';
import { importTaskKey } from './useImportTask';

/** 上传区：FileDropzone、重复上传的琥珀提示条（打开已有任务 / 继续处理 / 取消）与隐私说明；在页面里的位置由 ImportView 决定 */

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportUploadSection 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { busy, active, duplicateFile, duplicateTaskId, upload, uploadFile, openDuplicate } = ctx;
</script>

<template>
  <section class="space-y-3">
    <FileDropzone
      accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp"
      :disabled="busy || !!active"
      capture
      @files="upload"
    >
      <!--
        副文案走插槽而不是 hint：只在「·」后折行、两行等宽，手机上不会把「页」单独甩到第二行。
        三段必须写在同一行，段间空格才会保留（跨行的纯空白会被模板编译去掉）。
      -->
      <span class="text-balance text-xs text-faint"
        ><span class="whitespace-nowrap">PDF / PNG / JPG / WEBP ·</span> <span class="whitespace-nowrap">最大 30MB ·</span> <span class="whitespace-nowrap">最多 30 页</span></span
      >
      <span
        v-if="busy"
        class="mt-3 size-5 animate-spin rounded-full border-2 border-accent/25 border-t-accent"
        aria-hidden="true"
      />
    </FileDropzone>
    <Notice v-if="duplicateFile">
      相同内容的原件已经上传过，本次尚未开始解析。<template v-if="duplicateTaskId">可以打开已有任务继续处理。</template>
      <template #actions>
        <Button v-if="duplicateTaskId" size="sm" variant="primary" @click="openDuplicate">打开已有任务</Button>
        <Button size="sm" variant="secondary" :loading="busy" @click="uploadFile(duplicateFile!, true)">这是新的业务，继续处理</Button>
        <Button size="sm" variant="ghost" @click="duplicateFile = null">取消本次上传</Button>
      </template>
    </Notice>
    <p class="flex items-start gap-1.5 text-meta">
      <Icon name="info" :size="13" class="mt-[3px] shrink-0" />
      <span>启用自动智能导入后，每张单据的原件将发送给设置中的 AI 服务。最终入账需人工确认。</span>
    </p>
  </section>
</template>
