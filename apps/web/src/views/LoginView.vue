<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import Input from '@/components/ui/Input.vue';
import LineArt from '@/components/ui/LineArt.vue';
import Notice from '@/components/ui/Notice.vue';
import { useAuthStore } from '@/stores/auth';
import { useToastStore } from '@/stores/toast';
import { apiError } from '@/api/client';

type Mode = 'login' | 'setup' | 'recover';
/** 版本号来自 package.json（构建时注入），登录页页脚显示 */
const appVersion = __APP_VERSION__;

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
/** 恢复码是在哪一步发的：初始化（之后进入系统）或用恢复码重置密码（旧码已作废，之后回到登录） */
const issuedBy = ref<'setup' | 'recover'>('setup');
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
      issuedBy.value = 'setup';
    } else if (mode.value === 'recover') {
      const next = await auth.recover(recoveryCode.value.trim(), password.value);
      backToLogin();
      // 用过的恢复码已经作废：先把新的给用户保存，再回到登录
      recoveryCodeIssued.value = next;
      issuedBy.value = 'recover';
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
  if (issuedBy.value === 'recover') {
    toast.success('请用新密码登录');
    return;
  }
  void router.push('/workbench');
}

const heading = computed(() =>
  mode.value === 'setup' ? '设置管理员密码' : mode.value === 'recover' ? '用恢复码重置密码' : '登录',
);
const subheading = computed(() =>
  mode.value === 'setup'
    ? '首次使用，请为系统设置一个管理员密码（至少 8 位）'
    : mode.value === 'recover'
      ? '输入恢复码和新密码'
      : '输入管理员密码继续',
);

/** 桌面左栏的三条价值点 */
const VALUES = [
  { icon: 'file', title: '原件先存档', text: '上传即保存 OA 原件，确认后关联到申请，随时对照查看。' },
  { icon: 'layers', title: '按量采购可追溯', text: '同一明细可分次、分供应商采购，每批数量与成交价都留痕。' },
  { icon: 'inventory', title: '库存与领用同一本账', text: '直接发放、入库、领用与归还都按物品和单位记账。' },
];
/* 朱砂方印：品牌唯一的实心朱砂色块（与顶栏一致；实心底上的字用 primary-fg） */
const SEAL = 'flex items-center justify-center size-10 shrink-0 rounded-[5px] bg-accent text-sm font-bold leading-none text-primary-fg select-none';
</script>

<template>
  <!--
    「墨线」：纸色画布。桌面（≥ lg）左右两栏：左 5/12 是品牌面板（画布色，右边一条发丝线）——
    方印与词标、一幅墨线插画（粮仓与收成：门楣朱砂匾、谷穗、粮囤、远山与日轮）、一句定位与三条价值点；右边是表单面板。
    手机单栏：表单面板上方一幅 72px 的小粮仓（矮屏不显示），面板顶部自带方印与词标。
  -->
  <div class="min-h-dvh bg-canvas lg:grid lg:grid-cols-12">
    <aside class="paper-grain hidden border-r border-line lg:col-span-5 lg:flex lg:flex-col lg:px-12 lg:py-12 xl:px-16" aria-label="关于仓廪">
      <div class="flex items-center gap-3">
        <span :class="SEAL" aria-hidden="true">仓廪</span>
        <div class="min-w-0">
          <p class="text-lg leading-6 font-semibold text-ink">仓廪</p>
          <p class="text-[13px] text-muted">采购与领用</p>
        </div>
      </div>
      <div class="my-auto max-w-sm py-12">
        <LineArt name="granary-scene" :size="340" class="-ml-2 max-w-full text-faint" />
        <p class="mt-8 text-[22px] leading-8 font-bold tracking-[-0.01em] text-ink">从 OA 申请到领用，记在同一本账上</p>
        <p class="mt-2 text-[13px] leading-relaxed text-muted">导入或录入申请，分次采购、到货、发放与库存都跟着申请走，每一笔都能追到原件。</p>
        <ul class="mt-8 space-y-4">
          <li v-for="v in VALUES" :key="v.title" class="flex items-start gap-3">
            <Icon :name="v.icon" :size="18" class="mt-px shrink-0 text-muted" />
            <div class="min-w-0">
              <p class="text-sm leading-5 font-medium text-ink">{{ v.title }}</p>
              <p class="mt-0.5 text-[12.5px] leading-[18px] text-muted">{{ v.text }}</p>
            </div>
          </li>
        </ul>
      </div>
    </aside>

    <div class="flex min-h-dvh flex-col items-center justify-center px-4 py-10 lg:col-span-7">
      <!-- 手机：表单上方一幅小粮仓；矮屏（高 < 700px）不显示，免得把表单挤出首屏 -->
      <LineArt name="granary" :size="72" class="mb-5 text-faint lg:hidden [@media(max-height:699px)]:hidden" />
      <!-- 面板首帧轻弹入（animate-pop-in；减少动态效果时全局缩到近 0） -->
      <div class="w-full max-w-[420px] bg-surface border border-line rounded-xl p-6 sm:p-8 animate-pop-in">
        <!-- 品牌：朱砂方印 + 词标（与顶栏一致）；桌面上品牌在左栏，这里不再重复 -->
        <div class="mb-8 flex items-center gap-3 lg:hidden">
          <span :class="SEAL" aria-hidden="true">仓廪</span>
          <div class="min-w-0">
            <p class="text-lg leading-6 font-semibold text-ink">仓廪</p>
            <p class="text-[13px] text-muted">采购与领用</p>
          </div>
        </div>

        <!-- 服务端不可达 -->
        <div v-if="auth.unreachable" class="text-center">
          <span class="mx-auto flex items-center justify-center size-11 rounded-full bg-red-soft text-red">
            <Icon name="alert-circle" :size="20" />
          </span>
          <p class="mt-4 text-lg font-bold text-ink">连不上仓廪服务</p>
          <p class="mt-1 text-[13px] text-muted">服务可能还在启动，稍后点「重试」；一直连不上请检查服务器是否开着。</p>
          <Button variant="primary" size="lg" class="w-full mt-6" :loading="loading" @click="auth.refresh()">重试</Button>
        </div>

        <!-- 恢复码已生成（初始化成功） -->
        <div v-else-if="recoveryCodeIssued">
          <div class="flex items-center gap-2 text-teal">
            <Icon name="check-circle" :size="18" />
            <p class="text-lg font-bold">{{ issuedBy === 'recover' ? '密码已重置' : '初始化完成' }}</p>
          </div>
          <p class="mt-2 text-[13px] text-muted leading-relaxed">
            {{ issuedBy === 'recover' ? '刚才用的恢复码已经作废，请保存新的恢复码，忘记密码时用它重置：' : '请把恢复码保存在安全的地方，忘记密码时用它重置：' }}
          </p>
          <p class="mt-4 py-3 px-4 bg-surface-2 border border-line rounded-lg text-center font-mono text-lg tracking-[0.2em] text-ink select-all break-all">
            {{ recoveryCodeIssued }}
          </p>
          <Button variant="secondary" size="sm" class="w-full mt-3" @click="copyCode">
            <Icon :name="copied ? 'check' : 'copy'" :size="14" /> {{ copied ? '已复制' : '复制恢复码' }}
          </Button>
          <Notice tone="red" variant="inline" size="sm" class="mt-4">恢复码只显示这一次，离开页面后无法再次查看。</Notice>
          <Button variant="primary" size="lg" class="w-full mt-5" @click="finishSetup">{{ issuedBy === 'recover' ? '我已保存，去登录' : '我已保存，进入系统' }}</Button>
        </div>

        <template v-else>
          <h1 class="text-lg font-bold text-ink">{{ heading }}</h1>
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

            <Notice v-if="auth.status.locked" tone="red" size="sm">密码或恢复码输错次数过多，已暂时锁定，约 {{ lockMinutes }} 分钟后可重试</Notice>

            <Button variant="primary" size="lg" type="submit" class="w-full mt-2" :loading="loading" :disabled="auth.status.locked">
              {{ mode === 'setup' ? '初始化系统' : mode === 'recover' ? '重置密码' : '登录' }}
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

      <p class="mt-6 text-meta">本地部署 · 数据存在自己的服务器 · v{{ appVersion }}</p>
    </div>
  </div>
</template>
