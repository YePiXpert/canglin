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
/** 备份列表读取失败的原因：备份管理区块显示错误与重试，而不是「还没有备份」 */
const backupsError = ref('');
const loading = ref(true);
const loadError = ref('');
/** 系统状态面板的「刷新」进行中 */
const refreshing = ref(false);
/*
 * 交给面板的初始值：只在整页载入（首次、或整页失败后重新加载）时换成新对象，面板收到后回填表单。
 * 系统状态的「刷新」不碰它们，填到一半的 AI 连接与备份间隔不会被覆盖。
 */
const autoBackup = ref<SystemStatus['autoBackup']>({ enabled: false, intervalHours: 24, keepCount: 7 });
const aiConfig = ref<AiConfigView | null>(null);
/** AI 配置读取失败的原因：AI 区块显示错误与重试，而不是一张空表单 */
const aiError = ref('');
const aiRetrying = ref(false);
/** 地址里的 #区块 只在首次载入完成后定位一次；之后的「刷新」不再跳 */
let located = false;

/** 整页载入：四个请求并行。系统状态失败是整页的 ErrorState；备份列表、AI 配置失败只在各自区块报错 */
async function load(): Promise<void> {
  loading.value = status.value === null;
  const [s, list, ocr, ai] = await Promise.allSettled([
    systemApi.status(),
    systemApi.backups(),
    systemApi.ocrHealth(),
    aiApi.config(),
  ]);
  if (s.status === 'fulfilled') {
    status.value = s.value;
    autoBackup.value = s.value.autoBackup;
    loadError.value = '';
  } else {
    loadError.value = apiError(s.reason);
  }
  if (list.status === 'fulfilled') {
    backups.value = list.value;
    backupsError.value = '';
  } else {
    backupsError.value = apiError(list.reason);
  }
  ocrOk.value = ocr.status === 'fulfilled' ? ocr.value : false;
  if (ai.status === 'fulfilled') {
    aiConfig.value = ai.value;
    aiError.value = '';
  } else {
    aiError.value = apiError(ai.reason);
  }
  loading.value = false;
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

/** 系统状态面板的「刷新」：只重拉系统状态与 OCR 健康，不回填其它面板的表单 */
async function refreshStatus(): Promise<void> {
  if (refreshing.value) return;
  refreshing.value = true;
  const [s, ocr] = await Promise.allSettled([systemApi.status(), systemApi.ocrHealth()]);
  if (s.status === 'fulfilled') status.value = s.value;
  else toast.error(`系统状态刷新失败：${apiError(s.reason)}`);
  if (ocr.status === 'fulfilled') ocrOk.value = ocr.value;
  refreshing.value = false;
}

/** AI 配置读取失败后的「重试」：成功后交给面板回填表单（失败时面板不显示表单，没有可丢的编辑） */
async function retryAiConfig(): Promise<void> {
  if (aiRetrying.value) return;
  aiRetrying.value = true;
  try {
    aiConfig.value = await aiApi.config();
    aiError.value = '';
  } catch (e) {
    aiError.value = apiError(e);
  } finally {
    aiRetrying.value = false;
  }
}

async function recheckOcr(): Promise<void> {
  ocrChecking.value = true;
  ocrOk.value = await systemApi.ocrHealth();
  ocrChecking.value = false;
  toast.info(ocrOk.value ? 'OCR 服务正常' : 'OCR 服务仍不可用，请稍后再试或检查服务器');
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
      :refreshing="refreshing"
      @refresh="refreshStatus"
      @recheck-ocr="recheckOcr"
    />
    <AiSettingsPanel id="ai" :initial="aiConfig" :load-error="aiError" :retrying="aiRetrying" @retry="retryAiConfig" />
    <AutoBackupPanel id="auto-backup" :initial="autoBackup" />
    <BackupManagerPanel id="backups" v-model:backups="backups" v-model:error="backupsError" />
  </div>
</template>
