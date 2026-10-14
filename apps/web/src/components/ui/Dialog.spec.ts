import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, nextTick, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import Dialog from './Dialog.vue';

/**
 * Dialog 是 reka 的 DialogRoot：内容传送到 body。挂在 document.body 上，直接在 body 里找元素。
 * 外层组件持有 open，模拟调用方的 @update:open。
 */
let wrapper: VueWrapper | null = null;
const open = ref(true);
function mountDialog(props: Record<string, unknown> = {}) {
  open.value = true;
  wrapper = mount(
    defineComponent({
      setup() {
        return () =>
          h(
            Dialog,
            { open: open.value, title: '盘点调整', ...props, 'onUpdate:open': (v: boolean) => (open.value = v) },
            { default: () => h('p', '正文'), footer: ({ close }: { close: () => void }) => h('button', { type: 'button', class: 'cancel', onClick: close }, '取消') },
          );
      },
    }),
    { attachTo: document.body },
  );
  return wrapper;
}
const q = (selector: string) => document.body.querySelector<HTMLElement>(selector);
const button = (text: string) => [...document.body.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === text);
/** 真实按键事件是 cancelable 的：弹窗靠 preventDefault 区分「只关内层确认」与「关整个弹窗」 */
async function escape() {
  document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  await flushPromises();
}

afterEach(() => {
  wrapper?.unmount();
  wrapper = null;
});

describe('Dialog', () => {
  it('没有改动时 × 与「取消」（#footer 的 close）直接关闭', async () => {
    mountDialog();
    await flushPromises();
    expect(q('[role="dialog"]')).not.toBeNull();
    button('取消')!.click();
    await nextTick();
    expect(open.value).toBe(false);
  });

  it('dirty 时关闭先问「放弃未保存的修改？」：继续编辑留下，放弃才关', async () => {
    mountDialog({ dirty: true });
    await flushPromises();
    q('button[aria-label="关闭"]')!.click();
    await nextTick();
    expect(open.value).toBe(true);
    expect(q('[role="alertdialog"]')?.getAttribute('aria-label')).toBe('放弃未保存的修改');
    button('继续编辑')!.click();
    await nextTick();
    expect(q('[role="alertdialog"]')).toBeNull();
    expect(open.value).toBe(true);

    button('取消')!.click();
    await nextTick();
    button('放弃')!.click();
    await nextTick();
    expect(open.value).toBe(false);
  });

  it('Esc 先关掉内层的放弃确认，而不是整个弹窗', async () => {
    mountDialog({ dirty: true });
    await flushPromises();
    button('取消')!.click();
    await nextTick();
    expect(q('[role="alertdialog"]')).not.toBeNull();
    await escape();
    expect(q('[role="alertdialog"]')).toBeNull();
    expect(open.value).toBe(true);
    expect(q('[role="dialog"]')).not.toBeNull();
  });

  it('persistent：没有 ×，「取消」与 Esc 都关不掉', async () => {
    mountDialog({ persistent: true });
    await flushPromises();
    expect(q('button[aria-label="关闭"]')).toBeNull();
    button('取消')!.click();
    await nextTick();
    await escape();
    expect(open.value).toBe(true);
    expect(q('[role="dialog"]')).not.toBeNull();
  });

  it('有 description 时经 aria-describedby 朗读；没有说明时不带 aria-describedby', async () => {
    mountDialog({ description: '只调整这一个物品的库存' });
    await flushPromises();
    const dialog = q('[role="dialog"]')!;
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toContain('只调整这一个物品的库存');
    wrapper!.unmount();
    mountDialog();
    await flushPromises();
    expect(q('[role="dialog"]')!.hasAttribute('aria-describedby')).toBe(false);
  });
});
