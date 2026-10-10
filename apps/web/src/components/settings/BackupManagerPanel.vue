<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Icon from '@/components/ui/Icon.vue';
import Panel from '@/components/ui/Panel.vue';
import { systemApi, downloadFile, type BackupInfo } from '@/api';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/datetime';
import { formatBytes } from '@/utils/format';

/** 首屏由设置页 load() 拉取（骨架屏消失前就绪）；创建、删除备份后由本面板重新拉取并回写 */
const backups = defineModel<BackupInfo[]>('backups', { required: true });
const toast = useToastStore();

/* 备份操作 */
const creating = ref(false);
const restoring = ref(false);
const restoreTarget = ref<BackupInfo | null>(null);
const deleteBackupTarget = ref<BackupInfo | null>(null);
const downloadingBackup = ref('');

async function createBackup(): Promise<void> {
  creating.value = true;
  try {
    await systemApi.createBackup();
    toast.success('备份已创建');
    backups.value = await systemApi.backups();
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    creating.value = false;
  }
}

async function restore(): Promise<void> {
  if (!restoreTarget.value) return;
  const name = restoreTarget.value.name;
  restoreTarget.value = null;
  restoring.value = true;
  try {
    await systemApi.restoreBackup(name);
    toast.success('恢复完成，页面即将刷新');
    setTimeout(() => window.location.reload(), 1200);
  } catch (e) {
    restoring.value = false;
    toast.error(apiError(e));
  }
}

async function removeBackup(): Promise<void> {
  if (!deleteBackupTarget.value) return;
  try {
    await systemApi.deleteBackup(deleteBackupTarget.value.name);
    toast.success('备份已删除');
    deleteBackupTarget.value = null;
    backups.value = await systemApi.backups();
  } catch (e) {
    toast.error(apiError(e));
  }
}

/** 走带 Cookie 的 XHR，会话过期时能给出提示，而不是新开一个显示 401 JSON 的空标签页 */
async function download(backup: BackupInfo): Promise<void> {
  downloadingBackup.value = backup.name;
  try {
    await downloadFile(`/system/backups/${encodeURIComponent(backup.name)}/download`, backup.name);
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    downloadingBackup.value = '';
  }
}

const totalBackupSize = computed(() => backups.value.reduce((sum, b) => sum + b.sizeBytes, 0));
</script>

<template>
  <!-- 备份管理：表格贴边；手机（< 640px）每份备份一张卡片，操作在卡片底部 -->
  <Panel title="备份管理" description="恢复会覆盖当前数据库与附件，操作前请先创建备份" flush>
    <template #actions>
      <Button variant="secondary" size="sm" :loading="creating" @click="createBackup">
        <Icon name="plus" :size="14" /> 立即备份
      </Button>
    </template>
    <p v-if="backups.length === 0" class="px-5 py-10 text-center text-[13px] text-faint">还没有备份</p>
    <!-- 桌面：最高 384px 内部滚动、表头钉在滚动框顶边；手机卡片不设高度上限，随页面滚动 -->
    <div v-else class="overflow-auto sm:max-h-96">
      <table class="table-base table-sticky table-cards">
        <thead>
          <tr>
            <th class="pl-5">备份文件</th>
            <th>创建时间</th>
            <th class="text-right">大小</th>
            <th class="pr-5 text-right"><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in backups" :key="b.name">
            <!-- 主字段：表格里占满剩余宽度、单行截断；卡片里整行显示，长文件名折行 -->
            <td class="sm:w-full sm:max-w-0 sm:pl-5">
              <p class="break-words text-ink sm:truncate" :title="b.name">{{ b.name }}</p>
            </td>
            <td data-label="创建时间" class="num text-muted">{{ formatDateTime(b.createdAt) }}</td>
            <td data-label="大小" class="num text-right text-muted">{{ formatBytes(b.sizeBytes) }}</td>
            <!-- 表格：32px 按钮 + 上下 6px = 44px 行高；卡片：留白由 .card-actions 给，按钮 40px 触控高度，最后一个 -mr-2 与上方数值右对齐 -->
            <td class="card-actions text-right whitespace-nowrap sm:py-1.5 sm:pr-3">
              <button
                type="button"
                class="inline-flex items-center gap-1.5 h-8 max-sm:h-10 px-2 rounded-md text-[13px] text-muted hover:text-ink hover:bg-primary-soft transition-colors duration-150 cursor-pointer disabled:opacity-50 disabled:cursor-default"
                :disabled="downloadingBackup === b.name"
                @click="download(b)"
              >
                <Icon name="download" :size="14" />
                {{ downloadingBackup === b.name ? '下载中…' : '下载' }}
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 h-8 max-sm:h-10 px-2 rounded-md text-[13px] text-muted hover:text-amber hover:bg-amber-soft transition-colors duration-150 cursor-pointer"
                @click="restoreTarget = b"
              >
                <Icon name="restore" :size="14" />
                恢复
              </button>
              <button
                type="button"
                class="inline-flex items-center gap-1.5 h-8 max-sm:h-10 max-sm:-mr-2 px-2 rounded-md text-[13px] text-muted hover:text-red hover:bg-red-soft transition-colors duration-150 cursor-pointer"
                @click="deleteBackupTarget = b"
              >
                <Icon name="trash" :size="14" />
                删除
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="backups.length > 0" #footer>
      <p class="text-meta num">{{ backups.length }} 份 · 共 {{ formatBytes(totalBackupSize) }}</p>
    </template>
  </Panel>

  <!-- 恢复中：全屏挡住，避免用户在数据被覆盖的过程中继续操作 -->
  <div
    v-if="restoring"
    class="fixed inset-0 z-[90] flex items-center justify-center p-4 bg-ink/40 dark:bg-black/60 backdrop-blur-[2px]"
  >
    <div class="flex flex-col items-center gap-3 w-full max-w-xs px-6 py-6 text-center bg-surface border border-line rounded-[14px] shadow-(--shadow-pop)">
      <span class="size-8 border-[3px] border-line-strong border-t-ink rounded-full animate-spin" />
      <p class="text-[15px] font-semibold text-ink">正在恢复备份…</p>
      <p class="text-[13px] text-muted">服务短暂不可用，请不要关闭页面</p>
    </div>
  </div>

  <ConfirmDialog
    :open="!!restoreTarget"
    title="恢复备份"
    :message="`将用「${restoreTarget?.name}」覆盖当前数据库与附件，当前数据会被替换且无法找回。恢复期间服务短暂不可用。建议先点「立即备份」留一份当前数据。`"
    confirm-text="开始恢复"
    danger
    @update:open="restoreTarget = null"
    @confirm="restore"
  />
  <ConfirmDialog
    :open="!!deleteBackupTarget"
    title="删除备份"
    :message="`「${deleteBackupTarget?.name}」将被永久删除。`"
    confirm-text="删除"
    danger
    @update:open="deleteBackupTarget = null"
    @confirm="removeBackup"
  />
</template>
