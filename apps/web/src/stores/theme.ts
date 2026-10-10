import { defineStore } from 'pinia';
import { ref } from 'vue';

export type ThemeMode = 'light' | 'dark' | 'system';

const STORAGE_KEY = 'canglin-theme';
const DARK_MEDIA = '(prefers-color-scheme: dark)';

function readStored(): ThemeMode {
  const v = localStorage.getItem(STORAGE_KEY);
  return v === 'light' || v === 'dark' || v === 'system' ? v : 'system';
}

/**
 * 主题切换：mode 是用户选择（可跟随系统），resolved 是实际呈现。
 * 翻转靠给 <html> 切 .dark 类，令牌值在 main.css 的 .dark 块里覆盖。
 * index.html 里有内联脚本在首帧前预置 .dark，这里不会遇到闪烁。
 */
export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readStored());
  const resolved = ref<'light' | 'dark'>('light');

  function apply(): void {
    const dark =
      mode.value === 'dark' ||
      (mode.value === 'system' && window.matchMedia(DARK_MEDIA).matches);
    resolved.value = dark ? 'dark' : 'light';
    document.documentElement.classList.toggle('dark', dark);
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', dark ? '#141311' : '#f8f6f1');
  }

  function setMode(next: ThemeMode): void {
    mode.value = next;
    localStorage.setItem(STORAGE_KEY, next);
    apply();
  }

  /** 一键切换按当前实际显示取反，并脱离 system 跟随（点过就以手动为准） */
  function toggle(): void {
    setMode(resolved.value === 'dark' ? 'light' : 'dark');
  }

  function init(): void {
    apply();
    window.matchMedia(DARK_MEDIA).addEventListener('change', () => {
      if (mode.value === 'system') apply();
    });
  }

  return { mode, resolved, setMode, toggle, init };
});
