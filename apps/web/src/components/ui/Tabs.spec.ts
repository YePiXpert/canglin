import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import Tabs from './Tabs.vue';

const tabs = [
  { value: 'REFUND', label: '退款退货' },
  { value: 'REPLACEMENT', label: '换货补货' },
];

describe('Tabs', () => {
  it('点其它项发 update:modelValue 与 change；点当前项不发', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'REFUND', tabs, variant: 'segmented' } });
    const [refund, replacement] = wrapper.findAll('button');
    expect(refund.attributes('aria-pressed')).toBe('true');
    await refund.trigger('click');
    expect(wrapper.emitted('change')).toBeUndefined();
    await replacement.trigger('click');
    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['REPLACEMENT']);
    expect(wrapper.emitted('change')?.[0]).toEqual(['REPLACEMENT']);
  });

  it('disabled 时整组按钮禁用，不发事件（如保存中不许切换退货方式）', async () => {
    const wrapper = mount(Tabs, { props: { modelValue: 'REFUND', tabs, variant: 'segmented', disabled: true } });
    const buttons = wrapper.findAll('button');
    expect(buttons.every((b) => b.attributes('disabled') !== undefined)).toBe(true);
    await buttons[1].trigger('click');
    expect(wrapper.emitted('update:modelValue')).toBeUndefined();
  });
});
