import { afterEach, describe, expect, it } from 'vitest';
import { defineComponent, h, ref } from 'vue';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import Combobox from './Combobox.vue';

/** 外面包一层 v-model，像页面里那样用 */
function mountCombobox(initial = '', extra: Record<string, unknown> = {}) {
  const value = ref(initial);
  const selected: string[] = [];
  const Host = defineComponent({
    setup: () => () => h(Combobox, {
      modelValue: value.value, 'onUpdate:modelValue': (v: string) => { value.value = v; }, onSelect: (v: string) => selected.push(v),
      label: '经办人', options: ['王晓敏', { value: '李雷', note: '财务部' }, '王五一'], ...extra,
    }),
  });
  const wrapper = mount(Host, { attachTo: document.body });
  return { wrapper, value, selected, input: () => wrapper.find('input[aria-label="经办人"]') };
}
/** 每个选项读成「值 小字」 */
const options = () => [...document.body.querySelectorAll('[role="option"]')].map((el) => [...el.querySelectorAll('span')].map((span) => span.textContent?.trim()).join(' '));

let current: VueWrapper | undefined;
afterEach(() => {
  current?.unmount();
  current = undefined;
  document.body.innerHTML = '';
});

describe('Combobox：可以输入的下拉（docs/manual-entry-2026-10.md P2）', () => {
  it('打字就展开并筛选：「照打的字」在第一行（标「新的」），开头相同的在前', async () => {
    const { wrapper, value, input } = mountCombobox();
    current = wrapper;
    await input().setValue('王');
    await flushPromises();
    expect(value.value).toBe('王');
    expect(options()).toEqual(['王 新的', '王晓敏', '王五一']);
    expect(input().attributes('aria-expanded')).toBe('true');
  });

  it('打完直接回车留着打的字，不会被换成第一个已有选项', async () => {
    const { wrapper, value, selected, input } = mountCombobox();
    current = wrapper;
    await input().setValue('王五');
    await flushPromises();
    await input().trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(value.value).toBe('王五');
    expect(selected).toEqual(['王五']);
  });

  it('和已有的一模一样时不出现「新的」那一行；方向键往下选已有的', async () => {
    const { wrapper, value, input } = mountCombobox();
    current = wrapper;
    await input().setValue('李雷');
    await flushPromises();
    expect(options()).toEqual(['李雷 财务部']);
    await input().setValue('王');
    await flushPromises();
    await input().trigger('keydown', { key: 'ArrowDown' });
    await input().trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(value.value).toBe('王晓敏');
  });

  it('点箭头展开时列出全部（当前值在前），开始打字才筛', async () => {
    const { wrapper, input } = mountCombobox('王五一');
    current = wrapper;
    await wrapper.find('button[aria-label="展开经办人的选项"]').trigger('click');
    await flushPromises();
    expect(options()).toEqual(['王五一', '王晓敏', '李雷 财务部']);
    await input().setValue('李');
    await flushPromises();
    expect(options()).toEqual(['李 新的', '李雷 财务部']);
  });

  it('输入法组字时不改值，组完才改', async () => {
    const { wrapper, value, input } = mountCombobox();
    current = wrapper;
    await input().trigger('compositionstart');
    await input().trigger('compositionupdate', { data: '王' });
    (input().element as HTMLInputElement).value = 'wang';
    await input().trigger('input');
    expect(value.value).toBe('');
    (input().element as HTMLInputElement).value = '王';
    await input().trigger('compositionend', { data: '王' });
    await flushPromises();
    expect(value.value).toBe('王');
  });

  it('点开以后没打字、没按方向键就回车：只关下拉，不选最近用的那一个', async () => {
    const { wrapper, value, selected, input } = mountCombobox();
    current = wrapper;
    await wrapper.find('button[aria-label="展开经办人的选项"]').trigger('click');
    await flushPromises();
    expect(options().length).toBe(3);
    await input().trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(value.value).toBe('');
    expect(selected).toEqual([]);
    expect(input().attributes('aria-expanded')).toBe('false');
    // 按过方向键再回车才选
    await wrapper.find('button[aria-label="展开经办人的选项"]').trigger('click');
    await flushPromises();
    await input().trigger('keydown', { key: 'ArrowDown' });
    await input().trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(value.value).not.toBe('');
  });

  it('Home / End 留给框里移动光标，不被下拉拦下', async () => {
    const { wrapper, input } = mountCombobox('王晓敏');
    current = wrapper;
    for (const key of ['Home', 'End']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true });
      input().element.dispatchEvent(event);
      expect(event.defaultPrevented, key).toBe(false);
    }
  });
});
