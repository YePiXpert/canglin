import { ref } from 'vue';
import { apiError } from '@/api/client';
import { useToastStore } from '@/stores/toast';
export function usePlanningAction() {
  const busy = ref(false), failure = ref('');
  const toast = useToastStore();
  async function run(action: () => Promise<void>, message = '已保存') {
    if (busy.value) return false;
    busy.value = true; failure.value = '';
    try { await action(); if (message) toast.success(message); return true; }
    catch (e) { failure.value = apiError(e); return false; }
    finally { busy.value = false; }
  }
  return { busy, failure, run };
}
export const planningStatus: Record<string, string> = { DRAFT: '草稿', POSTED: '已记账', VOIDED: '已撤销', CANCELLED: '已取消', CONVERTED: '已生成申请', DISCARDED: '已放弃' };
