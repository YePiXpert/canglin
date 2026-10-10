<script setup lang="ts">
import { onMounted, ref } from 'vue';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Panel from '@/components/ui/Panel.vue';
import Tabs from '@/components/ui/Tabs.vue';
import type { TabItem } from '@/components/ui/tabs';
import AccountSecurityPanel from '@/components/settings/AccountSecurityPanel.vue';
import AiSettingsPanel from '@/components/settings/AiSettingsPanel.vue';
import AutoBackupPanel from '@/components/settings/AutoBackupPanel.vue';
import BackupManagerPanel from '@/components/settings/BackupManagerPanel.vue';
import SystemStatusPanel from '@/components/settings/SystemStatusPanel.vue';
import { systemApi, aiApi, type BackupInfo, type SystemStatus } from '@/api';
import { useToastStore } from '@/stores/toast';
import { useThemeStore, type ThemeMode } from '@/stores/theme';
import { apiError } from '@/api/client';
import type { AiConfigView } from '@procure-lite/shared';

const toast = useToastStore();
const theme = useThemeStore();

/* 外观主题三选一 */
const themeOptions: TabItem<ThemeMode>[] = [
  { value: 'light', label: '浅色', icon: 'sun' },
  { value: 'dark', label: '深色', icon: 'moon' },
  { value: 'system', label: '跟随系统', icon: 'settings' },
];

const status = ref<SystemStatus | null>(null);
const ocrOk = ref<boolean | null>(null);
const ocrChecking = ref(false);
const backups = ref<BackupInfo[]>([]);
const loading = ref(true);
const loadError = ref('');
/* 交给面板的初始值：load() 每次都换成新对象，面板收到后覆盖自己的表单 */
const autoBackup = ref<SystemStatus['autoBackup']>({ enabled: false, intervalHours: 24, keepCount: 7 });
const aiConfig = ref<AiConfigView | null>(null);

async function load(): Promise<void> {
  loading.value = status.value === null;
  try {
    const s = await systemApi.status();
    status.value = s;
    autoBackup.value = s.autoBackup;
    loadError.value = '';
    backups.value = await systemApi.backups().catch(() => []);
    ocrOk.value = await systemApi.ocrHealth();
    aiConfig.value = await aiApi.config().catch(() => null);
  } catch (e) {
    loadError.value = apiError(e);
  } finally {
    loading.value = false;
  }
}
onMounted(load);

async function recheckOcr(): Promise<void> {
  ocrChecking.value = true;
  ocrOk.value = await systemApi.ocrHealth();
  ocrChecking.value = false;
  toast.info(ocrOk.value ? 'OCR 服务正常' : 'OCR 服务仍不可用，检查容器是否在运行');
}
</script>

<template>
  <div v-if="loading" class="space-y-6">
    <Skeleton class="h-36" />
    <Skeleton class="h-80" />
    <Skeleton class="h-52" />
    <Skeleton class="h-96" />
  </div>
  <div v-else-if="loadError && !status" class="card">
    <ErrorState :message="loadError" @retry="load" />
  </div>

  <!-- 每个区块一个 Panel：头部标题 + 说明 + 右侧动作（#actions），内容 p-5；宽度由 SettingsLayout 限制在 960px -->
  <div v-else class="space-y-6">
    <!-- 外观 -->
    <Panel title="外观" description="界面明暗主题，跟随系统时随操作系统的显示设置切换">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p class="text-sm font-medium text-text">主题</p>
        <Tabs
          :model-value="theme.mode"
          variant="segmented"
          :tabs="themeOptions"
          aria-label="主题"
          @change="theme.setMode"
        />
      </div>
    </Panel>

    <AccountSecurityPanel />
    <SystemStatusPanel
      :status="status"
      :ocr-ok="ocrOk"
      :ocr-checking="ocrChecking"
      @refresh="load"
      @recheck-ocr="recheckOcr"
    />
    <AiSettingsPanel :initial="aiConfig" />
    <AutoBackupPanel :initial="autoBackup" />
    <BackupManagerPanel v-model:backups="backups" />
  </div>
</template>
