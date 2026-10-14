<script setup lang="ts">
import { computed, inject } from 'vue';
import Badge from '@/components/ui/Badge.vue';
import Button from '@/components/ui/Button.vue';
import FileDropzone from '@/components/ui/FileDropzone.vue';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import { importTaskKey } from './useImportTask';

/**
 * 上传区：FileDropzone（虚线 sheet）、重复上传的提示条（打开已有任务 / 继续处理 / 取消）与隐私说明；
 * 上传态（还没有任务）再加「上传之后会发生什么」三小段，上传框撑高到 280px。在页面里的位置由 ImportView 决定。
 */

const ctx = inject(importTaskKey);
if (!ctx) throw new Error('ImportUploadSection 只能放在 ImportView 里：缺少 useImportTask() 提供的上下文（importTaskKey）');
const { task, taskId, missing, busy, active, duplicateFile, duplicateTaskId, upload, uploadFile, openDuplicate } = ctx;
/** 上传态：地址里没有任务，或任务已不存在、要重新上传；核对任务时上传区退到页尾，只留紧凑的上传框 */
const intro = computed(() => !task.value && (!taskId.value || missing.value));
</script>

<template>
  <section class="min-w-0 space-y-3">
    <!-- 上传进度给读屏（转圈本身 aria-hidden）；元素常驻、只换文字 -->
    <p class="sr-only" role="status">{{ busy ? '正在上传原件…' : '' }}</p>
    <!--
      整块虚线框是一个 <label>，里面只有 FileDropzone 自己的那个 input[type=file]（e2e 直接对它 setInputFiles）。
      「选择文件」只是长得像主按钮的提示（pointer-events-none，点击落在 label 上照常打开文件选择），不进读屏；
      「拍照上传」由 FileDropzone 在手机上画在框下面（复用同一个 input）。
    -->
    <FileDropzone
      accept=".pdf,.png,.jpg,.jpeg,.webp,.bmp"
      label="把 PDF、OA 截图或手机照片拖到这里"
      :disabled="busy || !!active"
      capture
      :class="intro ? 'sm:[&>label]:min-h-70' : ''"
      @files="upload"
    >
      <!--
        限制说明走插槽而不是 hint：只在「·」后折行，手机上不会把半句甩到下一行。
        各段必须写在同一行，段间空格才会保留（跨行的纯空白会被模板编译去掉）。
      -->
      <span class="mt-1 text-balance text-xs text-faint"
        ><span class="whitespace-nowrap">PDF / PNG / JPG / WEBP ·</span> <span class="whitespace-nowrap">最大 30MB ·</span> <span class="whitespace-nowrap">最多 30 页 ·</span> <span class="whitespace-nowrap">相同原件再次上传会提示打开已有任务</span></span
      >
      <span v-if="busy" class="mt-3 flex h-8.5 items-center" aria-hidden="true">
        <span class="size-5 animate-spin rounded-full border-2 border-blue-soft border-t-blue" />
      </span>
      <span v-else :class="buttonClass({ variant: 'primary' })" class="pointer-events-none mt-3" aria-hidden="true"
        ><Icon name="upload" :size="16" />选择文件</span
      >
    </FileDropzone>

    <!-- 重复原件：一条 sheet——琥珀 chip「同一原件」+ 说明 + 三个动作（「打开已有任务」是主动作） -->
    <div v-if="duplicateFile" class="card flex flex-wrap items-center gap-x-3.5 gap-y-2.5 px-4.5 py-3.5">
      <Badge tone="amber">同一原件</Badge>
      <p class="min-w-60 flex-1 text-[13px] leading-5 text-text">
        相同内容的原件已经上传过，本次尚未开始解析。<template v-if="duplicateTaskId">可以打开已有任务继续处理。</template>
      </p>
      <div class="flex flex-wrap gap-2">
        <Button v-if="duplicateTaskId" size="sm" variant="primary" @click="openDuplicate">打开已有任务</Button>
        <Button size="sm" variant="secondary" :loading="busy" @click="uploadFile(duplicateFile!, true)">这是新的业务，继续处理</Button>
        <Button size="sm" variant="ghost" @click="duplicateFile = null">取消本次上传</Button>
      </div>
    </div>

    <p class="flex items-start gap-1.5 text-meta">
      <Icon name="info" :size="14" class="mt-0.5 shrink-0" />
      <span>启用自动智能导入后，每张单据的原件将发送给设置中的 AI 服务；未确认的原件保留 30 天。</span>
    </p>

    <div v-if="intro" class="card mt-6 px-4.5 py-4">
      <h2 class="text-[15px] leading-6 font-semibold text-ink">上传之后会发生什么</h2>
      <ol class="mt-2.5 grid gap-x-4 gap-y-3 text-[13px] leading-5 text-muted sm:grid-cols-3">
        <li><span class="mb-0.5 block font-medium text-ink">① 原件先保存</span>原件先存档，确认后关联到申请，之后随时可对照查看。</li>
        <li><span class="mb-0.5 block font-medium text-ink">② 逐页识别</span>AI 逐页读取原件，未启用或失败的页由本地 OCR 补充；仍失败可人工补录。</li>
        <li><span class="mb-0.5 block font-medium text-ink">③ 对照原件核对</span>核对单据头和每一行明细，确认后生成申请，可直接继续办理。</li>
      </ol>
    </div>
  </section>
</template>
