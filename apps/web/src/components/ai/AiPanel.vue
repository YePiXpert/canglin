<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui';
import Icon from '@/components/ui/Icon.vue';
import { buttonClass } from '@/components/ui/button';
import { aiApi, apiError } from '@/api';
import { useToastStore } from '@/stores/toast';
import { renderMarkdown } from '@/utils/markdown';
import type { AiConfigView } from '@canglin/shared';

const props = defineProps<{ open: boolean }>();
const emit = defineEmits<{ close: [] }>();

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  steps?: { name: string; args: Record<string, unknown>; count: number }[];
  error?: boolean;
}

const toast = useToastStore();
const messages = ref<ChatMessage[]>([]);
const draft = ref('');
const asking = ref(false);
const elapsed = ref(0);
const config = ref<AiConfigView | null>(null);
const configLoaded = ref(false);
const listEl = ref<HTMLElement | null>(null);
const inputEl = ref<HTMLTextAreaElement | null>(null);
const settingsLink = ref<{ $el: HTMLElement } | null>(null);

/** 配置过（已启用且有 Key）才展示对话；否则显示引导 */
const configured = computed(() => config.value?.enabled && config.value.apiKeySet);

const EXAMPLES = [
  '本月各部门采购金额是多少？',
  '哪些申请还有待采购的数量？',
  '上个月谁领用东西最多？',
  '未付款的采购单有哪些？',
];

let elapsedTimer: ReturnType<typeof setInterval> | null = null;

watch(
  () => props.open,
  (open) => {
    if (open && !configLoaded.value) {
      aiApi
        .config()
        .then((cfg) => {
          config.value = cfg;
          configLoaded.value = true;
          focusPrimary();
        })
        .catch(() => {
          // 401 已由拦截器统一处理；其他错误按未配置展示引导
          configLoaded.value = true;
          focusPrimary();
        });
    }
  },
);

onBeforeUnmount(() => {
  stopElapsed();
});

/**
 * 打开后焦点给输入框；配置读回来发现未启用（输入框随之消失）时交给「前往设置」。
 * Escape、点遮罩由 reka 交给 update:open；关闭后焦点回到打开它的顶栏按钮。
 */
function onOpenAutoFocus(event: Event): void {
  if (!inputEl.value) return;
  event.preventDefault();
  inputEl.value.focus();
}
function focusPrimary(): void {
  if (!props.open) return;
  void nextTick(() => (configured.value ? inputEl.value?.focus() : settingsLink.value?.$el?.focus()));
}

async function send(preset?: string): Promise<void> {
  const question = (preset ?? draft.value).trim();
  if (!question || asking.value) return;
  if (!configured.value) {
    toast.info('请先在设置中配置并启用 AI 助手');
    return;
  }
  draft.value = '';
  const history = messages.value
    .filter((m) => !m.error)
    .slice(-8)
    .map((m) => ({ role: m.role, content: m.content }));
  messages.value.push({ role: 'user', content: question });
  asking.value = true;
  startElapsed();
  scrollToBottom();
  try {
    const res = await aiApi.ask({ question, history });
    messages.value.push({ role: 'assistant', content: res.answer, steps: res.steps });
  } catch (e) {
    messages.value.push({ role: 'assistant', content: apiError(e), error: true });
  } finally {
    asking.value = false;
    stopElapsed();
    scrollToBottom();
    void nextTick(() => inputEl.value?.focus());
  }
}

function startElapsed(): void {
  elapsed.value = 0;
  elapsedTimer = setInterval(() => (elapsed.value += 1), 1000);
}

function stopElapsed(): void {
  if (elapsedTimer) clearInterval(elapsedTimer);
  elapsedTimer = null;
}

function scrollToBottom(): void {
  void nextTick(() => {
    if (listEl.value) listEl.value.scrollTop = listEl.value.scrollHeight;
  });
}

watch([messages, asking], () => scrollToBottom(), { deep: true });
</script>

<template>
  <!--
    reka 的 Dialog 原语（与手机「更多」抽屉同款）：焦点圈定在抽屉里，Escape / 点遮罩关闭，关闭后焦点回到触发按钮。
    可访问名称「AI 助手」、关闭按钮「关闭」、Enter 发送 / Shift+Enter 换行保持不变。
  -->
  <DialogRoot :open="props.open" @update:open="(v) => { if (!v) emit('close'); }">
    <DialogPortal>
      <DialogOverlay class="fixed inset-0 z-50 bg-ink/40 dark:bg-black/60 backdrop-blur-[2px] data-[state=open]:animate-fade-in" />
      <!-- 抽屉：面板色底，深色下左侧发丝线分层；打开时从右侧轻推入（@starting-style） -->
      <DialogContent
        aria-label="AI 助手"
        class="fixed inset-y-0 right-0 z-50 flex h-full w-full flex-col bg-surface shadow-(--shadow-pop) focus:outline-hidden sm:max-w-[440px] sm:border-l sm:border-line transition-transform duration-200 ease-out starting:translate-x-6"
        @open-auto-focus="onOpenAutoFocus"
      >
          <!-- 头部 -->
          <div class="flex h-14 shrink-0 items-center gap-3 px-4 border-b border-line">
            <span class="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-ink" aria-hidden="true">
              <Icon name="sparkles" :size="16" />
            </span>
            <div class="min-w-0 leading-tight">
              <DialogTitle class="text-[15px] leading-5 font-semibold text-ink">AI 助手</DialogTitle>
              <DialogDescription v-if="configured" class="text-meta truncate">{{ config?.model }} · 问答内容会发送给模型服务商</DialogDescription>
              <DialogDescription v-else class="text-meta">自然语言查询申请、单据与库存</DialogDescription>
            </div>
            <button
              type="button"
              class="ml-auto -mr-1.5 inline-flex size-8 shrink-0 items-center justify-center rounded-md text-faint hover:text-ink hover:bg-primary-soft transition-colors duration-150 cursor-pointer"
              aria-label="关闭"
              @click="emit('close')"
            >
              <Icon name="close" :size="16" />
            </button>
          </div>

          <!-- 未配置引导 -->
          <div
            v-if="configLoaded && !configured"
            class="flex flex-1 flex-col items-center justify-center overflow-y-auto px-8 py-10 text-center"
          >
            <span class="flex size-11 items-center justify-center rounded-xl bg-primary-soft text-ink">
              <Icon name="sparkles" :size="20" />
            </span>
            <p class="mt-4 text-sm font-semibold text-ink">AI 助手尚未启用</p>
            <p class="mt-1.5 max-w-xs text-[13px] leading-relaxed text-muted">
              在系统设置选择 Gemini、GPT 或 Grok 并配置接口后，即可用自然语言查询申请、采购与领用单据和库存。
            </p>
            <router-link
              ref="settingsLink"
              to="/settings#ai"
              class="mt-5"
              :class="buttonClass({ variant: 'primary', size: 'sm' })"
              @click="emit('close')"
            >
              前往设置
            </router-link>
          </div>

          <!-- 对话区 -->
          <div v-else ref="listEl" class="flex-1 overflow-y-auto px-4 py-5 space-y-4">
            <div v-if="messages.length === 0" class="space-y-3">
              <p class="text-xs text-muted">试试这样问：</p>
              <div class="flex flex-wrap gap-2">
                <button
                  v-for="q in EXAMPLES"
                  :key="q"
                  type="button"
                  class="inline-flex items-center min-h-8 px-3 py-1 rounded-full bg-primary-soft text-[13px] text-ink text-left hover:bg-line transition-colors duration-150 cursor-pointer"
                  @click="send(q)"
                >
                  {{ q }}
                </button>
              </div>
            </div>

            <template v-for="(m, i) in messages" :key="i">
              <div v-if="m.role === 'user'" class="flex justify-end">
                <div
                  class="max-w-[85%] px-3.5 py-2 text-sm leading-relaxed bg-ink text-surface rounded-(--radius-card) rounded-tr-[4px] whitespace-pre-wrap break-words"
                >
                  {{ m.content }}
                </div>
              </div>
              <div v-else class="space-y-1.5">
                <!-- 工具调用轨迹：默认折叠 -->
                <details v-if="m.steps?.length" class="group text-meta">
                  <summary
                    class="inline-flex items-center gap-1 cursor-pointer select-none list-none hover:text-muted transition-colors duration-150 [&::-webkit-details-marker]:hidden"
                  >
                    <Icon name="chevron-right" :size="12" class="shrink-0 transition-transform duration-150 group-open:rotate-90" />
                    已查询 {{ m.steps.length }} 次数据
                  </summary>
                  <ul class="mt-1 space-y-0.5 pl-4">
                    <li v-for="(s, j) in m.steps" :key="j" class="font-mono">
                      {{ s.name }}（{{ s.count }} 条）
                    </li>
                  </ul>
                </details>
                <!-- 助手回复是 Markdown：走 renderMarkdown（先转义 HTML，防注入）；用户消息保持纯文本 -->
                <!-- eslint-disable vue/no-v-html -- renderMarkdown 先整体转义 HTML，输出只含受控标签 -->
                <div
                  class="md max-w-[92%] px-3.5 py-2.5 text-sm leading-relaxed break-words border rounded-(--radius-card) rounded-tl-[4px]"
                  :class="m.error ? 'bg-red-soft text-red border-red/20' : 'bg-surface-2 border-line text-text'"
                  v-html="renderMarkdown(m.content)"
                ></div>
                <!-- eslint-enable vue/no-v-html -->
              </div>
            </template>

            <div v-if="asking" class="flex items-center gap-2 text-xs text-faint">
              <span class="inline-block size-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
              正在查询数据… {{ elapsed }}s
            </div>
          </div>

          <!-- 输入区 -->
          <div
            v-if="configured || !configLoaded"
            class="shrink-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] bg-surface border-t border-line"
          >
            <div class="flex items-end gap-2">
              <textarea
                ref="inputEl"
                v-model="draft"
                rows="2"
                placeholder="问点什么，如：上月行政部买了什么？（Enter 发送，Shift+Enter 换行）"
                class="control flex-1 min-w-0 px-3 py-2 text-base sm:text-sm leading-relaxed resize-none"
                :disabled="asking"
                @keydown.enter.exact.prevent="send()"
              />
              <button
                type="button"
                :class="buttonClass({ variant: 'primary', iconOnly: true })"
                :disabled="asking || !draft.trim()"
                aria-label="发送"
                @click="send()"
              >
                <span v-if="asking" class="inline-block size-3.5 border-2 border-current/30 border-t-current rounded-full animate-spin" />
                <Icon v-else name="send" :size="16" />
              </button>
            </div>
          </div>
      </DialogContent>
    </DialogPortal>
  </DialogRoot>
</template>
