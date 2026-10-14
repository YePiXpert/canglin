<script setup lang="ts">
import { provide } from 'vue';
import { useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Icon from '@/components/ui/Icon.vue';
import ImportDraftEditor from '@/components/import/ImportDraftEditor.vue';
import ImportHistoryPanel from '@/components/import/ImportHistoryPanel.vue';
import ImportOriginalPreview from '@/components/import/ImportOriginalPreview.vue';
import ImportRecognitionNotices from '@/components/import/ImportRecognitionNotices.vue';
import ImportRecognitionSteps from '@/components/import/ImportRecognitionSteps.vue';
import ImportServiceStatus from '@/components/import/ImportServiceStatus.vue';
import ImportStatusBar from '@/components/import/ImportStatusBar.vue';
import ImportTaskList from '@/components/import/ImportTaskList.vue';
import ImportUploadSection from '@/components/import/ImportUploadSection.vue';
import { importTaskKey, useImportTask } from '@/components/import/useImportTask';
import Notice from '@/components/ui/Notice.vue';
import PageHeader from '@/components/ui/PageHeader.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import StickyActionBar from '@/components/ui/StickyActionBar.vue';
import Tabs from '@/components/ui/Tabs.vue';

/**
 * 页面只做编排：状态与逻辑都在 useImportTask()（在这里调用一次，路由守卫与生命周期钩子注册在本页），
 * 再 provide 给 components/import/ 下的子组件；子组件经上下文读写同一份状态，不经 props。
 */
const ctx = useImportTask();
provide(importTaskKey, ctx);
const router = useRouter();
// rootEl、taskList 要绑定模板里的 ref="rootEl" / ref="taskList"，所以解构成顶层绑定
const { task, taskId, busy, error, saveError, loaded, finished, missing, mobileTab, rootEl, taskList } = ctx;
const { active, persist, reloadDraft, confirm, scrollToTask, confirmBlockers } = ctx;
const { discardOpen, discarding, discardError, discard, reloadOpen, confirmReloadDraft } = ctx;
</script>

<template>
  <div ref="rootEl" class="space-y-6">
    <PageHeader
      title="导入 OA 单据"
      description="保存原件 → AI 原件识别（本地 OCR 备用）→ 人工核对后入账。识别完成不等于入账，最终由你确认。"
    >
      <ImportServiceStatus />
    </PageHeader>

    <ImportRecognitionSteps :task="task" :task-id="taskId" :missing="missing" :finished="!!finished" />

    <!-- 提示与错误：核对阶段放进底部操作条（随时可见），其余阶段显示在这里 -->
    <template v-if="finished || !task">
      <Notice v-if="error" role="alert">{{ error }}</Notice>
      <Notice v-if="saveError" tone="red" role="alert">
        草稿保存失败：{{ saveError }}。请保留当前页面，避免丢失编辑。
        <template #actions>
          <Button size="sm" variant="secondary" @click="persist">重试保存</Button>
          <Button size="sm" variant="ghost" @click="reloadDraft">重新载入已保存版本</Button>
        </template>
      </Notice>
    </template>

    <!-- 完成：一张 sheet，绿色对勾 + 结果 + 主动作「继续办理申请」 -->
    <section v-if="finished" class="card flex flex-col items-start gap-4 px-5 py-4 sm:flex-row sm:items-center">
      <!-- 对勾按笔画描出来（300ms，animate-check-draw）；减少动态效果时直接显示画好的对勾 -->
      <span class="flex size-10 shrink-0 items-center justify-center rounded-full bg-teal-soft text-teal" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M20 6L9 17l-5-5" pathLength="1" stroke-dasharray="1" class="animate-check-draw" />
        </svg>
      </span>
      <div class="min-w-0 flex-1">
        <p class="text-[15px] leading-6 font-semibold text-ink">已确认导入</p>
        <p class="text-[13px] leading-5 text-muted">
          已创建 {{ finished.created }} 条，合并 {{ finished.merged }} 条，跳过 {{ finished.skipped }} 条；关联 {{ finished.attached }} 份原件。
        </p>
      </div>
      <Button variant="primary" class="max-sm:h-11 max-sm:w-full" @click="router.push(`/requests/${finished.requestId}`)">
        继续办理申请<Icon name="arrow-right" :size="16" />
      </Button>
    </section>

    <!-- 处理中 / 待核对 / 已确认（只读） -->
    <template v-else-if="task">
      <div class="space-y-3">
        <ImportStatusBar />
        <ImportRecognitionNotices />
      </div>

      <div class="space-y-4">
        <Tabs
          v-model="mobileTab"
          variant="segmented"
          block
          class="lg:hidden"
          :tabs="[
            { value: 'draft', label: '明细' },
            { value: 'original', label: '原件' },
          ]"
        />
        <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
          <ImportOriginalPreview />
          <ImportDraftEditor />
        </div>
      </div>

      <!--
        底部操作条：钉在 <main> 底边（桌面贴视口底边，手机贴在底部标签栏之上），通栏与贴边由 StickyActionBar 负责。
        本阶段的提示与错误（含已确认任务的只读提示）放在条内左侧，点确认后不用回到页顶找报错。
        有意放在草稿之后、历史与上传区之前（不是页面根元素的最后）：键盘顺序是「明细 → 保存 / 确认」，
        滚过草稿看历史、导入下一份时它跟着草稿走，不会压在上传区上面。父元素仍是页面根元素，通栏宽度不受影响。
      -->
      <StickyActionBar>
        <template #start>
          <!--
            保存失败带两个恢复按钮，用收紧的柔底提示块（box sm）：按钮框在报错的底色里，
            不会与右侧的主按钮连成一排四个。其它提示是 inline 的一行字。
          -->
          <Notice v-if="saveError" tone="red" variant="box" size="sm" role="alert">
            草稿保存失败：{{ saveError }}。请保留当前页面，避免丢失编辑。
            <template #actions>
              <Button size="sm" variant="secondary" @click="persist">重试保存</Button>
              <Button size="sm" variant="ghost" @click="reloadDraft">重新载入已保存版本</Button>
            </template>
          </Notice>
          <Notice v-if="error" variant="inline" role="alert">{{ error }}</Notice>
          <!--
            还不能入账的原因（与确认时的校验同一套规则）：长单子不用滚回去逐行找「数量未确认」。
            不是 alert（随编辑变化，不该反复打断读屏）；确认按钮经 aria-describedby 指向它。
          -->
          <Notice v-if="confirmBlockers.length && !active" id="import-confirm-blockers" variant="inline" size="sm">
            还不能导入：{{ confirmBlockers.join('；') }}
          </Notice>
        </template>
        <Button v-if="!task.confirmed" variant="danger-ghost" class="max-sm:basis-full" :disabled="busy || discarding" @click="discardOpen = true">放弃草稿</Button>
        <Button
          variant="secondary"
          class="max-sm:flex-1"
          :disabled="task.confirmed"
          @click="persist"
          >保存草稿</Button
        >
        <Button
          variant="primary"
          class="max-sm:flex-1"
          :disabled="!!active || task.confirmed || !loaded || confirmBlockers.length > 0"
          :loading="busy"
          :aria-describedby="confirmBlockers.length && !active ? 'import-confirm-blockers' : undefined"
          @click="confirm"
          >确认全部内容并导入</Button
        >
      </StickyActionBar>

      <ImportHistoryPanel />
    </template>

    <!-- 地址里的任务不存在：说明原因，不自动新建任务（下面的上传区与列表照常可用） -->
    <Notice v-else-if="missing" role="alert">任务不存在或已被清理（未确认的原件保留 30 天），请重新上传原件。</Notice>

    <!-- 已有任务编号、任务还没取回：骨架占位 -->
    <div v-else-if="taskId" class="space-y-4" aria-hidden="true">
      <Skeleton class="h-18 w-full" />
      <div class="grid gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <Skeleton class="h-96" />
        <Skeleton class="h-96 max-lg:hidden" />
      </div>
    </div>

    <!--
      上传区（左）与导入任务（右 400px）：上传态紧跟在步骤条下面；有任务后两栏一起留在页尾，核对完可以直接导入下一份。
      上传区只有一个实例，里面始终只有一个 input[type=file]。外层用 div 而不是 section：
      e2e 按「含标题『未完成的导入』的 section」找任务面板，外面再套 section 会把上传区也圈进去。
    -->
    <div class="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_400px]">
      <ImportUploadSection />
      <ImportTaskList ref="taskList" :current-task-id="taskId" :current-task="task" @current="scrollToTask" />
    </div>
    <ConfirmDialog v-model:open="discardOpen" title="放弃草稿？"
      :message="`将删除「${task?.filename ?? ''}」的草稿和原件，并停止识别。不会创建申请；需要时可重新上传原件。`"
      confirm-text="放弃草稿" danger :loading="discarding" @confirm="discard">
      <Notice v-if="discardError" tone="red" role="alert">{{ discardError }}</Notice>
    </ConfirmDialog>
    <ConfirmDialog v-model:open="reloadOpen" title="重新载入已保存版本？"
      message="当前未保存的编辑会被替换成上次成功保存的草稿，替换后不能找回。"
      confirm-text="重新载入" danger @confirm="confirmReloadDraft" />
  </div>
</template>
