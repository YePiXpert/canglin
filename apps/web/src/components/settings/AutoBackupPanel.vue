<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import Button from '@/components/ui/Button.vue';
import Input from '@/components/ui/Input.vue';
import Panel from '@/components/ui/Panel.vue';
import Switch from '@/components/ui/Switch.vue';
import { systemApi, type SystemStatus } from '@/api';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';

const props = defineProps<{
  /** 设置页 load() 读到的自动备份配置；每次 load 都是新对象，到达时覆盖表单 */
  initial: SystemStatus['autoBackup'];
}>();
const toast = useToastStore();

/* 自动备份 */
const backupForm = reactive({ enabled: false, intervalHours: '24', keepCount: '7' });
const backupErrors = reactive<Record<string, string>>({});
const backupSaving = ref(false);

watch(
  () => props.initial,
  (autoBackup) => {
    Object.assign(backupForm, {
      enabled: autoBackup.enabled,
      intervalHours: String(autoBackup.intervalHours),
      keepCount: String(autoBackup.keepCount),
    });
  },
  { immediate: true },
);

/* -------------------------------- 自动备份 -------------------------------- */

function validateBackup(): boolean {
  Object.keys(backupErrors).forEach((k) => delete backupErrors[k]);
  const interval = Number(backupForm.intervalHours);
  const keep = Number(backupForm.keepCount);
  if (!Number.isInteger(interval) || interval < 1 || interval > 720) {
    backupErrors.intervalHours = '间隔需为 1–720 的整数小时';
  }
  if (!Number.isInteger(keep) || keep < 1 || keep > 100) {
    backupErrors.keepCount = '保留份数需为 1–100 的整数';
  }
  return Object.keys(backupErrors).length === 0;
}

async function saveBackupConfig(): Promise<void> {
  if (!validateBackup()) return;
  backupSaving.value = true;
  try {
    await systemApi.updateAutoBackup({
      enabled: backupForm.enabled,
      intervalHours: Number(backupForm.intervalHours),
      keepCount: Number(backupForm.keepCount),
    });
    toast.success('自动备份配置已保存');
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    backupSaving.value = false;
  }
}
</script>

<template>
  <!-- 自动备份：开关一行；间隔、保留份数与保存一行 -->
  <Panel title="自动备份" description="定期打包数据库与附件，保留最近 N 份" flush>
    <div class="divide-y divide-line">
      <!-- 说明走 Switch 的 description（aria-describedby），这里把它调成设置行的 12.5px muted -->
      <Switch
        v-model="backupForm.enabled"
        label-position="left"
        description="保留份数包含手动创建的备份；每次自动备份后，超出份数的最早备份会被删除"
        class="w-full justify-between px-5 py-3.5 [&_.text-meta]:text-[12.5px] [&_.text-meta]:text-muted"
      >
        <span class="text-[13.5px] font-medium text-ink">启用自动备份</span>
      </Switch>
      <div class="grid grid-cols-2 gap-4 px-5 py-4 sm:flex sm:flex-wrap sm:items-start">
        <Input
          v-model="backupForm.intervalHours"
          label="间隔（小时）"
          type="number"
          min="1"
          max="720"
          class="sm:w-32"
          :error="backupErrors.intervalHours"
        />
        <Input
          v-model="backupForm.keepCount"
          label="保留份数"
          type="number"
          min="1"
          max="100"
          class="sm:w-32"
          :error="backupErrors.keepCount"
        />
        <Button
          variant="primary"
          class="col-span-2 justify-self-end sm:ml-auto sm:mt-6.5"
          :loading="backupSaving"
          @click="saveBackupConfig"
          >保存</Button
        >
      </div>
    </div>
  </Panel>
</template>
