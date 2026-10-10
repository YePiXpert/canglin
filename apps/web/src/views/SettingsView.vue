<script setup lang="ts">
import { inject, nextTick, onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import ErrorState from '@/components/ui/ErrorState.vue';
import Skeleton from '@/components/ui/Skeleton.vue';
import Panel from '@/components/ui/Panel.vue';
import Tabs from '@/components/ui/Tabs.vue';
import type { TabItem } from '@/components/ui/tabs';
import AccountSecurityPanel from '@/components/settings/AccountSecurityPanel.vue';
import AiSettingsPanel from '@/components/settings/AiSettingsPanel.vue';
import AutoBackupPanel from '@/components/settings/AutoBackupPanel.vue';
import BackupManagerPanel from '@/components/settings/BackupManagerPanel.vue';
import SettingRow from '@/components/settings/SettingRow.vue';
import SystemStatusPanel from '@/components/settings/SystemStatusPanel.vue';
import { SETTINGS_JUMP, isSettingsSection } from '@/components/settings/sections';
import { systemApi, aiApi, type BackupInfo, type SystemStatus } from '@/api';
import { useToastStore } from '@/stores/toast';
import { useThemeStore, type ThemeMode } from '@/stores/theme';
import { apiError } from '@/api/client';
import type { AiConfigView } from '@canglin/shared';

const toast = useToastStore();
const theme = useThemeStore();
const route = useRoute();
/** SettingsLayout 提供；单独挂载（没有外层布局）时为 undefined */
const jumpTo = inject(SETTINGS_JUMP, undefined);

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
/** 地址里的 #区块 只在首次载入完成后定位一次；之后的「刷新」不再跳 */
let located = false;

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
  if (!located && status.value) {
    located = true;
    const id = route.hash.slice(1);
    if (isSettingsSection(id)) {
      await nextTick();
      jumpTo?.(id, false);
    }
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
  <div v-if="loading" class="space-y-5">
    <Skeleton class="h-28" />
    <Skeleton class="h-40" />
    <Skeleton class="h-52" />
    <Skeleton class="h-80" />
  </div>
  <div v-else-if="loadError && !status" class="card">
    <ErrorState :message="loadError" @retry="load" />
  </div>

  <!--
    每个区块一个 Panel：标题行（标题 + 说明 + 右侧动作）+ 设置行（左 label 与说明、右控件，行间发丝线）。
    id 是子导航的锚点（components/settings/sections.ts）；宽度由 SettingsLayout 限制在 760px。
  -->
  <div v-else class="space-y-5">
    <Panel id="appearance" title="外观" flush>
      <SettingRow label="主题" description="跟随系统时随操作系统的显示设置切换">
        <Tabs :model-value="theme.mode" variant="segmented" :tabs="themeOptions" aria-label="主题" @change="theme.setMode" />
      </SettingRow>
    </Panel>

    <AccountSecurityPanel id="account" />
    <SystemStatusPanel
      id="status"
      :status="status"
      :ocr-ok="ocrOk"
      :ocr-checking="ocrChecking"
      @refresh="load"
      @recheck-ocr="recheckOcr"
    />
    <AiSettingsPanel id="ai" :initial="aiConfig" />
    <AutoBackupPanel id="auto-backup" :initial="autoBackup" />
    <BackupManagerPanel id="backups" v-model:backups="backups" />
  </div>
</template>
