import { onMounted, onBeforeUnmount } from 'vue';
/** Keep reminders current after returning to the app and across the business-day boundary. */
export function useVisibleRefresh(refresh: () => unknown) {
  let timer: ReturnType<typeof setInterval> | undefined;
  function visible() { if (document.visibilityState === 'visible') void refresh(); }
  onMounted(() => { document.addEventListener('visibilitychange', visible); window.addEventListener('focus', visible); timer = setInterval(visible, 60_000); });
  onBeforeUnmount(() => { document.removeEventListener('visibilitychange', visible); window.removeEventListener('focus', visible); clearInterval(timer); });
}
