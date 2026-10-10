<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import Notice from '@/components/ui/Notice.vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { apiError } from '@/api/client';

type Mode = 'login' | 'setup' | 'recover';

const auth = useAuthStore();
const toast = useToastStore();
const router = useRouter();
const route = useRoute();

const recoverOpen = ref(false);
const mode = computed<Mode>(() => (!auth.isInitialized ? 'setup' : recoverOpen.value ? 'recover' : 'login'));

const password = ref('');
const passwordConfirm = ref('');
const recoveryCode = ref('');
const recoveryCodeIssued = ref('');
const loading = ref(false);
const copied = ref(false);
const errors = ref<Record<string, string>>({});

const lockMinutes = computed(() => Math.ceil(auth.status.lockRemainingSeconds / 60));

function validate(): boolean {
  const next: Record<string, string> = {};
  if (mode.value === 'setup') {
    if (password.value.length < 8) next.password = '密码至少 8 位';
    if (password.value !== passwordConfirm.value) next.confirm = '两次输入的密码不一致';
  } else if (mode.value === 'recover') {
    if (!recoveryCode.value.trim()) next.recoveryCode = '请输入恢复码';
    if (password.value.length < 8) next.password = '新密码至少 8 位';
    if (password.value !== passwordConfirm.value) next.confirm = '两次输入的新密码不一致';
  } else if (!password.value) {
    next.password = '请输入密码';
  }
  errors.value = next;
  return Object.keys(next).length === 0;
}

async function submit(): Promise<void> {
  if (loading.value) return;
  if (!validate()) return;
  loading.value = true;
  try {
    if (mode.value === 'setup') {
      recoveryCodeIssued.value = await auth.setup(password.value);
    } else if (mode.value === 'recover') {
      await auth.recover(recoveryCode.value.trim(), password.value);
      toast.success('密码已重置，请用新密码登录');
      backToLogin();
    } else {
      await auth.login(password.value);
      toast.success('登录成功');
      const redirect = (route.query.redirect as string) || '/workbench';
      void router.push(redirect);
    }
  } catch (e) {
    toast.error(apiError(e));
    // 失败次数与锁定状态只有服务端知道；不刷新的话用户看不到「还剩几分钟解锁」
    await auth.refresh();
  } finally {
    loading.value = false;
  }
}

function backToLogin(): void {
  recoverOpen.value = false;
  password.value = '';
  passwordConfirm.value = '';
  recoveryCode.value = '';
  errors.value = {};
}

function openRecover(): void {
  recoverOpen.value = true;
  password.value = '';
  passwordConfirm.value = '';
  errors.value = {};
}

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(recoveryCodeIssued.value);
    copied.value = true;
    setTimeout(() => (copied.value = false), 2000);
  } catch {
    toast.info('复制失败，请手动选中文本复制');
  }
}

function finishSetup(): void {
  recoveryCodeIssued.value = '';
  void router.push('/workbench');
}

const heading = computed(() =>
  mode.value === 'setup' ? '设置管理员密码' : mode.value === 'recover' ? '用恢复码重置密码' : '登录',
);
const subheading = computed(() =>
  mode.value === 'setup'
    ? '首次使用，请为系统设置一个管理员密码（至少 8 位）'
    : mode.value === 'recover'
      ? '输入初始化时生成的恢复码与新密码'
      : '单管理员模式，输入密码继续',
);
</script>

<template>
  <!-- 「墨线」：纸色画布上一张居中的面板，没有背景纹理 -->
  <div class="min-h-dvh bg-canvas flex flex-col items-center justify-center px-4 py-10">
    <div class="w-full max-w-[420px] bg-surface border border-line rounded-xl p-6 sm:p-8">
      <!-- 品牌：朱砂方印 + 词标（与顶栏一致） -->
      <div class="flex items-center gap-3">
        <span class="flex items-center justify-center size-10 shrink-0 rounded-[5px] bg-accent text-sm font-bold leading-none text-primary-fg select-none" aria-hidden="true">仓廪</span>
        <div class="min-w-0">
          <p class="text-lg leading-6 font-semibold text-ink">仓廪</p>
          <p class="text-[13px] text-muted">采购与领用 · 单管理员</p>
        </div>
      </div>

      <!-- 服务端不可达 -->
      <div v-if="auth.unreachable" class="mt-8 text-center">
        <span class="mx-auto flex items-center justify-center size-11 rounded-full bg-red-soft text-red">
          <Icon name="alert-circle" :size="20" />
        </span>
        <p class="mt-4 text-lg font-bold text-ink">连接不上后端服务</p>
        <p class="mt-1 text-[13px] text-muted">服务可能还在启动，或者容器没跑起来。</p>
        <Button variant="primary" size="lg" class="w-full mt-6" :loading="loading" @click="auth.refresh()">重试</Button>
      </div>

      <!-- 恢复码已生成（初始化成功） -->
      <div v-else-if="recoveryCodeIssued" class="mt-8">
        <div class="flex items-center gap-2 text-teal">
          <Icon name="check-circle" :size="18" />
          <p class="text-lg font-bold">初始化完成</p>
        </div>
        <p class="mt-2 text-[13px] text-muted leading-relaxed">
          请把恢复码保存在安全的地方，密码遗忘时用它重置：
        </p>
        <p class="mt-4 py-3 px-4 bg-surface-2 border border-line rounded-lg text-center font-mono text-lg tracking-[0.2em] text-ink select-all break-all">
          {{ recoveryCodeIssued }}
        </p>
        <Button variant="secondary" size="sm" class="w-full mt-3" @click="copyCode">
          <Icon :name="copied ? 'check' : 'copy'" :size="14" /> {{ copied ? '已复制' : '复制恢复码' }}
        </Button>
        <Notice tone="red" variant="inline" size="sm" class="mt-4">恢复码只显示这一次，离开页面后无法再次查看。</Notice>
        <Button variant="primary" size="lg" class="w-full mt-5" @click="finishSetup">我已保存，进入系统</Button>
      </div>

      <template v-else>
        <h1 class="mt-8 text-lg font-bold text-ink">{{ heading }}</h1>
        <p class="mt-1 mb-6 text-[13px] text-muted">{{ subheading }}</p>

        <form class="space-y-4" @submit.prevent="submit">
          <Input
            v-if="mode === 'recover'"
            v-model="recoveryCode"
            label="恢复码"
            placeholder="16 位恢复码"
            required
            autocomplete="one-time-code"
            :error="errors.recoveryCode"
          />
          <Input
            v-model="password"
            type="password"
            :label="mode === 'login' ? '密码' : '新密码'"
            :placeholder="mode === 'login' ? '请输入密码' : '至少 8 位'"
            required
            :autocomplete="mode === 'login' ? 'current-password' : 'new-password'"
            :error="errors.password"
          />
          <Input
            v-if="mode !== 'login'"
            v-model="passwordConfirm"
            type="password"
            label="确认密码"
            placeholder="再输入一次"
            required
            autocomplete="new-password"
            :error="errors.confirm"
          />

          <Notice v-if="auth.status.locked" tone="red" size="sm">失败次数过多已锁定，约 {{ lockMinutes }} 分钟后可重试</Notice>

          <Button variant="primary" size="lg" type="submit" class="w-full mt-2" :loading="loading" :disabled="auth.status.locked">
            {{ mode === 'setup' ? '初始化系统' : mode === 'recover' ? '重置密码' : '登 录' }}
          </Button>
        </form>

        <!-- 进恢复模式后必须能回来：原来这个按钮在 recover 模式下会消失 -->
        <Button v-if="mode === 'login'" variant="link" class="mt-5 text-[13px]" @click="openRecover">
          忘记密码？使用恢复码
        </Button>
        <Button v-else-if="mode === 'recover'" variant="link" class="mt-5 text-[13px]" @click="backToLogin">
          <Icon name="chevron-left" :size="14" /> 返回登录
        </Button>
      </template>
    </div>

    <p class="mt-6 text-meta">本地部署 · 数据自持 · v2.0</p>
  </div>
</template>
