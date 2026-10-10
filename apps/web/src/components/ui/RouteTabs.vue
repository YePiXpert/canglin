<script setup lang="ts">
import { RouterLink } from 'vue-router';
import Icon from './Icon.vue';
import { UNDERLINE_INDICATOR, UNDERLINE_LIST, underlineCountClass, underlineItemClass, type RouteTabItem } from './tabs';

/**
 * 路由版 underline 标签（SettingsLayout 用）：每项是 router-link，
 * 当前项按 exact 取 isExactActive / isActive；aria-current="page" 与 router-link 默认行为一致。
 */
defineProps<{ tabs: RouteTabItem[]; ariaLabel?: string }>();
</script>

<template>
  <nav :aria-label="ariaLabel" :class="UNDERLINE_LIST">
    <RouterLink v-for="t in tabs" :key="t.to" v-slot="{ href, navigate, isActive, isExactActive }" :to="t.to" custom>
      <a
        :href="href"
        :aria-current="isExactActive ? 'page' : undefined"
        :class="underlineItemClass(t.exact ? isExactActive : isActive)"
        @click="navigate"
      >
        <Icon v-if="t.icon" :name="t.icon" :size="15" class="shrink-0" />
        {{ t.label }}
        <span v-if="t.count !== undefined && t.count !== null" :class="underlineCountClass(t.exact ? isExactActive : isActive)">{{ t.count }}</span>
        <span v-if="t.exact ? isExactActive : isActive" :class="UNDERLINE_INDICATOR" aria-hidden="true" />
      </a>
    </RouterLink>
  </nav>
</template>
