import { onBeforeUnmount, ref, shallowRef } from 'vue';
import { apiError } from '@/api/client';
import { createRequestGuard } from '@/utils/request';

/**
 * 一个异步资源的加载 / 刷新 / 失败状态（DESIGN.md §6「加载、空与错误」）：
 * - loading：首次加载（还没有数据）——页面画骨架；refreshing：已有数据时再次加载——保留旧内容，不闪空；
 * - error：最近一次失败的原因（apiError）；成功后清空；
 * - 过期响应（又发起了新的加载、或组件已卸载）直接丢弃（createRequestGuard）；
 * - reset()：换对象（如路由参数变了）时清空数据，下次 load 回到首次加载。
 */
export function useResource<T>(fetch: () => Promise<T>) {
  const data = shallowRef<T | null>(null);
  const loading = ref(true);
  const refreshing = ref(false);
  const error = ref('');
  const guard = createRequestGuard();
  onBeforeUnmount(() => guard.abandon());

  async function load() {
    const isCurrent = guard.begin();
    loading.value = data.value === null;
    refreshing.value = data.value !== null;
    try {
      const result = await fetch();
      if (!isCurrent()) return;
      data.value = result;
      error.value = '';
    } catch (cause) {
      if (isCurrent()) error.value = apiError(cause);
    } finally {
      if (isCurrent()) {
        loading.value = false;
        refreshing.value = false;
      }
    }
  }

  function reset() {
    guard.abandon();
    data.value = null;
    error.value = '';
    loading.value = true;
    refreshing.value = false;
  }

  return { data, loading, refreshing, error, load, reset };
}
