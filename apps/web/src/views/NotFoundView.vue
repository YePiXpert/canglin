<script setup lang="ts">
import { useRouter } from 'vue-router';
import Button from '@/components/ui/Button.vue';
import Icon from '@/components/ui/Icon.vue';

const router = useRouter();
</script>

<template>
  <div class="min-h-dvh bg-canvas flex flex-col items-center justify-center px-4 py-10">
    <div class="w-full max-w-[420px] bg-surface border border-line rounded-xl p-6 sm:p-8 flex flex-col items-center text-center">
      <span class="flex size-11 items-center justify-center rounded-xl bg-surface-2 text-muted" aria-hidden="true">
        <Icon name="search" :size="20" />
      </span>
      <h1 class="mt-3 text-lg font-bold text-ink">页面不存在</h1>
      <p class="mt-1 text-[13px] text-muted">地址可能输错了，或者这个页面已经被移除。</p>
      <div class="mt-6 flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-center">
        <Button variant="secondary" size="lg" class="sm:flex-1" @click="router.back()">返回上一页</Button>
        <Button variant="primary" size="lg" class="sm:flex-1" @click="router.push('/workbench')">回到工作台</Button>
      </div>
    </div>
  </div>
</template>
