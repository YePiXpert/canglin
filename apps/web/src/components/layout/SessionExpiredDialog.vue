<script setup lang="ts">
import { ref } from 'vue';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Input from '@/components/ui/Input.vue';
import { apiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';

/**
 * 会话过期时原地重新登录（AppShell 挂载，经 api/client 的 onSessionExpired 注册）：
 * 30 分钟无操作后回来提交，弹窗里填了一半的内容不丢——重新登录后拦截器把失败的请求重放一次。
 * 确认框排版 + 一个密码框，persistent（只能「重新登录」或「去登录页」）；放弃时走原来的跳转登录页。
 */
const auth = useAuthStore();
const open = ref(false);
const password = ref('');
const error = ref('');
const busy = ref(false);
let waiting: ((ok: boolean) => void)[] = [];

/** 打开弹窗并等待结果：true = 已重新登录，false = 放弃 */
function ask(): Promise<boolean> {
  if (!open.value) {
    password.value = '';
    error.value = '';
    open.value = true;
  }
  return new Promise((resolve) => waiting.push(resolve));
}

function finish(ok: boolean): void {
  open.value = false;
  password.value = '';
  const settle = waiting;
  waiting = [];
  for (const resolve of settle) resolve(ok);
}

async function submit(): Promise<void> {
  if (busy.value) return;
  if (!password.value) {
    error.value = '请输入密码';
    return;
  }
  busy.value = true;
  error.value = '';
  try {
    await auth.login(password.value);
    finish(true);
  } catch (e) {
    error.value = apiError(e);
  } finally {
    busy.value = false;
  }
}

defineExpose({ ask, cancel: () => finish(false) });
</script>

<template>
  <Dialog
    :open="open"
    title="会话已过期，请重新登录"
    description="长时间没有操作，登录已失效。输入密码后会接着完成刚才的操作，页面上填写的内容不会丢失。"
    width="400px"
    :mobile-fullscreen="false"
    compact
    persistent
  >
    <Input
      v-model="password"
      type="password"
      label="密码"
      autocomplete="current-password"
      :error="error"
      :disabled="busy"
      @update:model-value="error = ''"
      @enter="submit"
    />
    <template #footer>
      <Button variant="ghost" :disabled="busy" @click="finish(false)">去登录页</Button>
      <Button variant="primary" :loading="busy" @click="submit">重新登录</Button>
    </template>
  </Dialog>
</template>
