import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import ConfirmDialog from './ConfirmDialog.vue';

let wrapper: VueWrapper | null = null;
const open = ref(true);
const confirms = ref(0);
function mountConfirm(props: Record<string, unknown> = {}) {
  open.value = true;
  confirms.value = 0;
  wrapper = mount(
    defineComponent({
      setup: () => () =>
        h(ConfirmDialog, {
          open: open.value, title: '删除备份', message: '「backup.zip」将被永久删除。', confirmText: '删除', danger: true, ...props,
          'onUpdate:open': (v: boolean) => (open.value = v), onConfirm: () => confirms.value++,
        }),
    }),
    { attachTo: document.body },
  );
}
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text)!;
async function escape() {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flushPromises();
}
afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('ConfirmDialog', () => {
  it('message 是确认框的说明（aria-describedby）；确认发 confirm，取消关闭', async () => {
    mountConfirm();
    await flushPromises();
    const dialog = document.body.querySelector('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('将被永久删除');
    button('删除').click();
    expect(confirms.value).toBe(1);
    button('取消').click();
    await flushPromises();
    expect(open.value).toBe(false);
  });

  it('loading 时确认转圈禁用、「取消」禁用，Esc 关不掉', async () => {
    mountConfirm({ loading: true });
    await flushPromises();
    expect(button('删除').disabled).toBe(true);
    expect(button('取消').disabled).toBe(true);
    await escape();
    expect(open.value).toBe(true);
  });
});
