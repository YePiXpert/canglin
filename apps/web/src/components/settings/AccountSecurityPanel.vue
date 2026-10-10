<script setup lang="ts">
import { reactive, ref, watch } from 'vue';
import { useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Dialog from '@/components/ui/Dialog.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import Panel from '@/components/ui/Panel.vue';
import SettingRow from './SettingRow.vue';
import { http } from '@/api';
import { apiError } from '@/api/client';
import { useDialogForm } from '@/composables/useDialogForm';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';

/* 多个根节点（面板 + 弹窗）：设置页传来的 id（子导航锚点）落在面板上 */
defineOptions({ inheritAttrs: false });

const toast = useToastStore();
const auth = useAuthStore();
const router = useRouter();

/* --------------------------------- 修改密码 --------------------------------- */

const passwordOpen = ref(false);
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirm: '' });
const {
  saving: passwordSaving,
  failure: passwordFailure,
  errors: passwordErrors,
  dirty: passwordDirty,
  reset: resetPasswordForm,
  submit: submitPassword,
} = useDialogForm(() => JSON.stringify(passwordForm));

function clearPasswordForm(): void {
  Object.assign(passwordForm, { currentPassword: '', newPassword: '', confirm: '' });
}

function openPasswordDialog(): void {
  clearPasswordForm();
  resetPasswordForm();
  passwordOpen.value = true;
}

/** 弹窗一关（取消、×、遮罩、Esc 或修改成功）就清掉输入的密码 */
watch(passwordOpen, (open) => {
  if (!open) clearPasswordForm();
});

function validatePassword(): boolean {
  const next: Record<string, string> = {};
  if (!passwordForm.currentPassword) next.currentPassword = '请输入当前密码';
  if (passwordForm.newPassword.length < 8) next.newPassword = '新密码至少 8 位';
  else if (passwordForm.newPassword === passwordForm.currentPassword) {
    next.newPassword = '新密码不能与当前密码相同';
  }
  if (passwordForm.newPassword !== passwordForm.confirm) next.confirm = '两次输入的新密码不一致';
  passwordErrors.value = next;
  return Object.keys(next).length === 0;
}

async function changePassword(): Promise<void> {
  if (passwordSaving.value || !validatePassword()) return;
  // 失败时 submit 把原因写进 passwordFailure（页脚显示），弹窗保持打开
  const done = await submitPassword(() =>
    http.post('/auth/change-password', {
      currentPassword: passwordForm.currentPassword,
      newPassword: passwordForm.newPassword,
    }),
  );
  if (done === undefined) return;
  passwordOpen.value = false;
  // 服务端改密后会递增 sessionEpoch 踢掉所有会话（含当前这个），
  // 不主动跳转的话用户下一次点任何东西都会莫名其妙被弹回登录页
  toast.success('密码已修改，所有登录会话已失效，请用新密码重新登录');
  auth.loggedIn = false;
  setTimeout(() => void router.push('/login'), 900);
}

/* --------------------------------- 恢复码 --------------------------------- */

const recoveryPassword = ref('');
const recoveryCodeIssued = ref('');
const recoveryDialogOpen = ref(false);
const generating = ref(false);
const copied = ref(false);

/** 「重置恢复码」弹窗一关（取消、×、遮罩、Esc 或生成成功）就清掉输入的密码 */
watch(recoveryDialogOpen, (open) => {
  if (!open) recoveryPassword.value = '';
});

async function regenerateRecovery(): Promise<void> {
  if (!recoveryPassword.value) {
    toast.error('请输入当前密码');
    return;
  }
  generating.value = true;
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
    generating.value = false;
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
</script>

<template>
  <!-- 账号安全：退出登录在顶栏的账号菜单（手机在「更多」里），这里不再重复 -->
  <Panel v-bind="$attrs" title="账号安全" description="单管理员模式，会话 30 分钟无操作自动过期" flush>
    <div class="divide-y divide-line">
      <SettingRow label="登录密码" description="修改后所有已登录会话立即失效，需要用新密码重新登录">
        <Button size="sm" @click="openPasswordDialog">修改密码</Button>
      </SettingRow>
      <SettingRow label="恢复码" description="忘记密码时用它重置；重新生成后旧恢复码立即失效">
        <Button size="sm" @click="recoveryDialogOpen = true"><Icon name="key" :size="14" />重置恢复码</Button>
      </SettingRow>
    </div>
  </Panel>

  <!-- 修改密码 -->
  <Dialog
    :open="passwordOpen"
    title="修改密码"
    description="修改后所有已登录会话立即失效，需要用新密码重新登录。"
    width="440px"
    :dirty="passwordDirty && !passwordSaving"
    :persistent="passwordSaving"
    @update:open="passwordOpen = $event"
  >
    <div class="grid gap-4">
      <Input
        v-model="passwordForm.currentPassword"
        type="password"
        label="当前密码"
        autocomplete="current-password"
        :disabled="passwordSaving"
        :error="passwordErrors.currentPassword"
      />
      <Input
        v-model="passwordForm.newPassword"
        type="password"
        label="新密码"
        placeholder="至少 8 位"
        autocomplete="new-password"
        :disabled="passwordSaving"
        :error="passwordErrors.newPassword"
      />
      <Input
        v-model="passwordForm.confirm"
        type="password"
        label="确认新密码"
        autocomplete="new-password"
        :disabled="passwordSaving"
        :error="passwordErrors.confirm"
        @enter="changePassword"
      />
    </div>
    <template #footer="{ close }">
      <Notice v-if="passwordFailure" role="alert" tone="red" variant="inline" class="mr-auto self-center">{{ passwordFailure }}</Notice>
      <Button variant="ghost" :disabled="passwordSaving" @click="close">取消</Button>
      <Button variant="primary" :loading="passwordSaving" @click="changePassword">修改密码</Button>
    </template>
  </Dialog>

  <!-- 恢复码结果 -->
  <!-- 两个小弹窗内容很短，手机上也保持居中小卡片（与 ConfirmDialog 一致），不铺满全屏 -->
  <Dialog :open="!!recoveryCodeIssued" title="新的恢复码" width="420px" persistent :mobile-fullscreen="false">
    <p class="text-sm text-muted">请立即保存，只显示这一次：</p>
    <p
      class="mt-4 py-3 px-4 bg-surface-2 border border-line rounded-(--radius-control) text-center font-mono text-lg tracking-[0.2em] text-ink select-all break-all"
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
    :dirty="recoveryPassword.length > 0 && !generating"
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
      <Button variant="primary" :loading="generating" @click="regenerateRecovery">生成</Button>
    </template>
  </Dialog>
</template>
