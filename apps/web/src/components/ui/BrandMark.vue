<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 32 });
</script>
<template>
  <img src="/favicon.svg" :width="size" :height="size" class="shrink-0 select-none" alt="" aria-hidden="true" draggable="false" />
</template>
