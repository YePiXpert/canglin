<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';
import LineArt from '@/components/ui/LineArt.vue';

/**
 * 页面级错误边界（AppShell 里包住 <router-view>）：页面组件渲染或 setup 抛错时，
 * 原位居中显示墨线插画（打翻的墨水瓶）+「页面出现异常」+「重新加载」，而不是留下一片空白；路由变化时自动重置。
 * 只接管渲染与 setup 的错误：事件处理、异步回调里的错误照旧交给 main.ts 的全局兜底（toast），
 * 点一个按钮失败不该把整页换成错误页。console.error 保留，便于排查。
 */
const route = useRoute();
const failed = ref(false);

/** Vue 的错误来源：开发版是可读字符串，生产版是 error-reference 链接（#runtime-0 = setup、#runtime-1 = render） */
function isRenderError(info: string): boolean {
  return info === 'render function' || info === 'setup function' || /#runtime-[01]$/.test(info);
}

onErrorCaptured((err, _instance, info) => {
  if (!isRenderError(info)) return;
  console.error(err);
  failed.value = true;
  return false;
});

watch(
  () => route.fullPath,
  () => {
    failed.value = false;
  },
);

function reload(): void {
  window.location.reload();
}
</script>

<template>
  <div v-if="failed" class="card flex flex-col items-center px-6 py-10 text-center">
    <LineArt name="spill" :size="200" class="text-faint" />
    <h2 class="mt-5 text-[15px] leading-6 font-semibold text-ink">页面出现异常</h2>
    <p class="mt-1 max-w-sm text-[13px] text-muted">这一页显示时出错了。点「重新加载」通常就能恢复，也可以先去其他页面。</p>
    <Button size="sm" class="mt-4" @click="reload"><Icon name="refresh" :size="14" />重新加载</Button>
  </div>
  <slot v-else />
</template>
