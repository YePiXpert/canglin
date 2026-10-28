import { describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { setupAutoUpdate } from './pwa';

const Page = defineComponent({ render: () => null });
const tick = () => new Promise((resolve) => setTimeout(resolve));

async function start() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/a', component: Page }, { path: '/b', component: Page }] });
  await router.push('/a');
  const reload = vi.fn();
  const register = vi.fn();
  setupAutoUpdate(router, register, reload);
  const { immediate, onNeedReload } = register.mock.calls[0]![0];
  return { router, reload, immediate, onNeedReload: onNeedReload as () => void };
}

describe('setupAutoUpdate', () => {
  it('新版本接管时不当场刷新，下次切换页面再载入', async () => {
    const { router, reload, immediate, onNeedReload } = await start();
    expect(immediate).toBe(true);
    await router.push('/b'); await tick();
    expect(reload).not.toHaveBeenCalled();

    onNeedReload(); await tick();
    expect(reload).not.toHaveBeenCalled();
    await router.push('/b?page=2'); await tick();
    expect(reload).not.toHaveBeenCalled();
    await router.push('/a'); await tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('离开确认拦下切换时不刷新', async () => {
    const { router, reload, onNeedReload } = await start();
    onNeedReload();
    const stay = router.beforeEach(() => false);
    await router.push('/b'); await tick();
    expect(reload).not.toHaveBeenCalled();
    stay();
    await router.push('/b'); await tick();
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
