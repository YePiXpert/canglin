<script setup lang="ts">
import { computed, ref } from 'vue';
import Button from '@/components/ui/Button.vue';
import ConfirmDialog from '@/components/ui/ConfirmDialog.vue';
import Dialog from '@/components/ui/Dialog.vue';
import EmptyState from '@/components/ui/EmptyState.vue';
import Icon from '@/components/ui/Icon.vue';
import Menu from '@/components/ui/Menu.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import type { MenuItem } from '@/components/ui/types';
import { systemApi, downloadFile, type BackupInfo } from '@/api';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
import { formatDateTime } from '@/utils/datetime';
import { formatBytes } from '@/utils/format';

/* 多个根节点（面板、恢复中遮罩、确认框）：设置页传来的 id（子导航锚点）落在面板上 */
defineOptions({ inheritAttrs: false });

/** 首屏由设置页 load() 拉取（骨架屏消失前就绪）；创建、删除备份后由本面板重新拉取并回写 */
const backups = defineModel<BackupInfo[]>('backups', { required: true });
/** 列表读取失败的原因（设置页首屏或本面板重新拉取时写入）：有错误且没有旧列表时显示错误与重试，而不是「还没有备份」 */
const listError = defineModel<string>('error', { default: '' });
const toast = useToastStore();

/* 备份操作 */
const creating = ref(false);
const reloading = ref(false);
const restoring = ref(false);
const restoreTarget = ref<BackupInfo | null>(null);
const deleteBackupTarget = ref<BackupInfo | null>(null);
const deleting = ref(false);
const downloadingBackup = ref('');

/** 重新拉取列表；失败只记在 listError，不弹 Toast（创建、删除本身已经成功时不该报成失败） */
async function reloadList(): Promise<void> {
  reloading.value = true;
  try {
    backups.value = await systemApi.backups();
    listError.value = '';
  } catch (e) {
    listError.value = apiError(e);
  } finally {
    reloading.value = false;
  }
}

async function createBackup(): Promise<void> {
  creating.value = true;
  try {
    await systemApi.createBackup();
    toast.success('备份已创建');
  } catch (e) {
    toast.error(apiError(e));
    return;
  } finally {
    creating.value = false;
  }
  await reloadList();
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

/** 删除在途时忽略重复点击（确认按钮转圈禁用、确认框不可关），只发一个请求 */
async function removeBackup(): Promise<void> {
  if (!deleteBackupTarget.value || deleting.value) return;
  deleting.value = true;
  try {
    await systemApi.deleteBackup(deleteBackupTarget.value.name);
    toast.success('备份已删除');
    deleteBackupTarget.value = null;
  } catch (e) {
    toast.error(apiError(e));
    return;
  } finally {
    deleting.value = false;
  }
  await reloadList();
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

/** 行内只放「下载」；恢复与删除都会覆盖或丢弃数据，收进「…」并各走确认框 */
function moreActions(backup: BackupInfo): MenuItem[] {
  return [
    { label: '恢复到这份备份', icon: 'restore', onSelect: () => (restoreTarget.value = backup) },
    { label: '删除', icon: 'trash', danger: true, onSelect: () => (deleteBackupTarget.value = backup) },
  ];
}
</script>

<template>
  <!-- 备份管理：表格贴边；手机（< 640px）每份备份一张卡片，操作在卡片底部 -->
  <Panel v-bind="$attrs" title="备份管理" description="恢复会覆盖当前数据库与附件，操作前请先创建备份" flush>
    <template #actions>
      <Button variant="secondary" size="sm" :loading="creating" @click="createBackup">
        <Icon name="plus" :size="14" /> 立即备份
      </Button>
    </template>
    <div v-if="listError && backups.length === 0" class="px-5 py-4">
      <Notice tone="red" variant="inline">
        备份列表读取失败：{{ listError }}
        <template #actions>
          <Button variant="link" :loading="reloading" @click="reloadList">重试</Button>
        </template>
      </Notice>
    </div>
    <EmptyState v-else-if="backups.length === 0" art="archive" title="还没有备份" description="点「立即备份」留一份当前数据；开启自动备份后会按间隔生成。" />
    <!-- 桌面：最高 384px 内部滚动、表头钉在滚动框顶边；手机卡片不设高度上限，随页面滚动 -->
    <div v-else class="overflow-auto sm:max-h-96">
      <table class="table-base table-sticky table-cards">
        <thead>
          <tr>
            <th scope="col" class="pl-5">备份文件</th>
            <th scope="col">创建时间</th>
            <th scope="col" class="text-right">大小</th>
            <th scope="col" class="pr-5 text-right"><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in backups" :key="b.name">
            <!-- 主字段：表格里占满剩余宽度、单行截断；卡片里整行显示，长文件名折行 -->
            <td class="sm:w-full sm:max-w-0 sm:pl-5">
              <p class="break-all font-mono text-[12.5px] text-ink sm:truncate" :title="b.name">{{ b.name }}</p>
            </td>
            <td data-label="创建时间" class="num text-muted">{{ formatDateTime(b.createdAt) }}</td>
            <td data-label="大小" class="num text-right text-muted">{{ formatBytes(b.sizeBytes) }}</td>
            <td class="card-actions sm:whitespace-nowrap sm:py-2 sm:pr-4">
              <div class="flex items-center justify-end gap-1">
                <Button size="sm" :loading="downloadingBackup === b.name" @click="download(b)">
                  <Icon v-if="downloadingBackup !== b.name" name="download" :size="14" />下载
                </Button>
                <Menu :items="moreActions(b)" :trigger-label="`${b.name} 的更多操作`" />
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
    <template v-if="backups.length > 0" #footer>
      <p class="text-meta num">{{ backups.length }} 份 · 共 {{ formatBytes(totalBackupSize) }}</p>
      <Notice v-if="listError" tone="red" variant="inline" size="sm" class="mt-1">
        列表刷新失败：{{ listError }}
        <template #actions>
          <Button variant="link" :loading="reloading" @click="reloadList">重试</Button>
        </template>
      </Notice>
    </template>
  </Panel>

  <!--
    恢复中：persistent 的模态弹窗挡住整页（焦点圈在弹窗里，键盘也点不到「立即备份」），
    数据被覆盖的过程中不能继续操作；进度文字是 role="status"，读屏能听到。
  -->
  <Dialog
    :open="restoring"
    title="正在恢复备份"
    description="服务短暂不可用，请不要关闭页面。"
    width="360px"
    :mobile-fullscreen="false"
    compact
    persistent
  >
    <div class="flex items-center gap-3 pt-2 pb-1" role="status">
      <span class="size-5 shrink-0 border-2 border-line-strong border-t-ink rounded-full animate-spin" aria-hidden="true" />
      <span class="text-[13px] text-muted">正在用备份覆盖数据库与附件，完成后页面会自动刷新…</span>
    </div>
  </Dialog>

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
    :loading="deleting"
    @update:open="deleteBackupTarget = null"
    @confirm="removeBackup"
  />
</template>
