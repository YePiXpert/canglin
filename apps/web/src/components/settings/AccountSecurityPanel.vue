<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import { http } from '@/api';
import { apiError } from '@/api/client';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

const toast = useToastStore();
const auth = useAuthStore();
const router = useRouter();

/* 账号 */
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const passwordErrors = reactive<Record<string, string>>({});
const recoveryPassword = ref('');
const recoveryCodeIssued = ref('');
const recoveryDialogOpen = ref(false);
const changing = ref(false);
const copied = ref(false);

/* --------------------------------- 账号 --------------------------------- */

function validatePassword(): boolean {
  Object.keys(passwordErrors).forEach((k) => delete passwordErrors[k]);
  if (!passwordForm.currentPassword) passwordErrors.currentPassword = '请输入当前密码';
  if (passwordForm.newPassword.length < 8) passwordErrors.newPassword = '新密码至少 8 位';
  else if (passwordForm.newPassword === passwordForm.currentPassword) {
    passwordErrors.newPassword = '新密码不能与当前密码相同';
  }
  if (passwordForm.newPassword !== passwordForm.confirm)
    passwordErrors.confirm = '两次输入的新密码不一致';
  return Object.keys(passwordErrors).length === 0;
}

async function changePassword(): Promise<void> {
  if (!validatePassword()) return;
  changing.value = true;
  try {
    await http.post('/auth/change-password', {
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    });
    passwordForm.currentPassword = passwordForm.newPassword = passwordForm.confirm = '';
    // 服务端改密后会递增 sessionEpoch 踢掉所有会话（含当前这个），
    // 不主动跳转的话用户下一次点任何东西都会莫名其妙被弹回登录页
    toast.success('密码已修改，所有登录会话已失效，请用新密码重新登录');
    auth.loggedIn = false;
    setTimeout(() => void router.push('/login'), 900);
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    changing.value = false;
  }
}

/** 「重置恢复码」弹窗一关（取消、×、遮罩、Esc 或生成成功）就清掉输入的密码 */
watch(recoveryDialogOpen, (open) => {
  if (!open) recoveryPassword.value = '';
});

async function regenerateRecovery(): Promise<void> {
  if (!recoveryPassword.value) {
    toast.error('请输入当前密码');
    return;
  }
  changing.value = true;
  try {
    const res = await http.post<{ recoveryCode: string }>('/auth/recovery-code', {
      password: recoveryPassword.value,
    });
    recoveryCodeIssued.value = res.data.recoveryCode;
    copied.value = false;
    recoveryDialogOpen.value = false;
    recoveryPassword.value = '';
  } catch (e) {
    toast.error(apiError(e));
  } finally {
    changing.value = false;
  }
}

async function copyRecoveryCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(recoveryCodeIssued.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    toast.info('复制失败，请手动选中文本复制');
  }
}

async function logout(): Promise<void> {
  await auth.logout();
  void router.push('/login');
}
</script>

<template>
  <!-- 账号安全 -->
  <Panel title="账号安全" description="单管理员模式，会话 30 分钟无操作自动过期">
    <template #actions>
      <Button variant="ghost" size="sm" class="-mr-2" @click="logout">
        <Icon name="logout" :size="14" /> 退出登录
      </Button>
    </template>
    <div class="grid gap-4 sm:grid-cols-2">
      <Input
        v-model="passwordForm.currentPassword"
        type="password"
        label="当前密码"
        autocomplete="current-password"
        :error="passwordErrors.currentPassword"
      />
      <Input
        v-model="passwordForm.newPassword"
        type="password"
        label="新密码"
        placeholder="至少 8 位"
        autocomplete="new-password"
        class="sm:col-start-1"
        :error="passwordErrors.newPassword"
      />
      <Input
        v-model="passwordForm.confirm"
        type="password"
        label="确认新密码"
        autocomplete="new-password"
        :error="passwordErrors.confirm"
      />
    </div>
    <div class="mt-5 flex flex-wrap items-center justify-between gap-3">
      <p class="text-meta">修改密码会让所有已登录会话失效，你需要用新密码重新登录。</p>
      <div class="ml-auto flex flex-wrap gap-2">
        <Button variant="secondary" @click="recoveryDialogOpen = true">
          <Icon name="key" :size="16" /> 重置恢复码
        </Button>
        <Button variant="primary" :loading="changing" @click="changePassword">修改密码</Button>
      </div>
    </div>
  </Panel>

  <!-- 恢复码结果 -->
  <!-- 两个小弹窗内容很短，手机上也保持居中小卡片（与 ConfirmDialog 一致），不铺满全屏 -->
  <Dialog :open="!!recoveryCodeIssued" title="新的恢复码" width="420px" persistent :mobile-fullscreen="false">
    <p class="text-sm text-muted">请立即保存，只显示这一次：</p>
    <p
      class="mt-4 py-3 px-4 bg-surface-2 border border-line rounded-lg text-center font-mono text-lg tracking-[0.2em] text-ink select-all break-all"
    >
      {{ recoveryCodeIssued }}
    </p>
    <Button variant="secondary" size="sm" class="mt-3 w-full" @click="copyRecoveryCode">
      <Icon :name="copied ? 'check' : 'copy'" :size="14" /> {{ copied ? '已复制' : '复制恢复码' }}
    </Button>
    <Notice tone="red" variant="inline" size="sm" class="mt-4">关掉这个窗口后无法再次查看，旧恢复码已经失效。</Notice>
    <template #footer>
      <Button variant="primary" @click="recoveryCodeIssued = ''">我已保存</Button>
    </template>
  </Dialog>

  <!-- 重置恢复码确认 -->
  <Dialog
    :open="recoveryDialogOpen"
    title="重置恢复码"
    width="420px"
    :mobile-fullscreen="false"
    :dirty="recoveryPassword.length > 0 && !changing"
    @update:open="recoveryDialogOpen = $event"
  >
    <p class="text-sm text-muted mb-4">输入当前密码以生成新的恢复码，旧恢复码将失效。</p>
    <Input
      v-model="recoveryPassword"
      type="password"
      label="当前密码"
      autocomplete="current-password"
      required
      @enter="regenerateRecovery"
    />
    <template #footer="{ close }">
      <Button variant="ghost" @click="close">取消</Button>
      <Button variant="primary" :loading="changing" @click="regenerateRecovery">生成</Button>
    </template>
  </Dialog>
</template>
