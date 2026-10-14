<script setup lang="ts">
import { onErrorCaptured, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import ErrorState from '@/components/ui/ErrorState.vue';

/**
 * 页面级错误边界（AppShell 里包住 <router-view>）：页面组件渲染或 setup 抛错时，
 * 原位显示「页面出现异常」+「重新加载」，而不是留下一片空白；路由变化时自动重置。
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
  <div v-if="failed" class="card">
    <ErrorState
      title="页面出现异常"
      message="这一页显示时出错了，错误已记录在浏览器控制台。重新加载通常可以恢复；切换到其它页面也会重置。"
      @retry="reload"
    />
  </div>
  <slot v-else />
</template>
