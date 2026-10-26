<script setup lang="ts">
withDefaults(defineProps<{ size?: number }>(), { size: 32 });
const src = `/favicon.svg?v=${__BRAND_REVISION__}`;
</script>
<template>
  <img :src="src" :width="size" :height="size" class="shrink-0 select-none" alt="" aria-hidden="true" draggable="false" />
</template>
