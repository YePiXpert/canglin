import { describe, expect, it } from 'vitest';
import { h } from 'vue';
import { mount } from '@vue/test-utils';
import ErrorState from './ErrorState.vue';

describe('ErrorState', () => {
  it('原位错误：标题默认「加载失败」+ 原因 +「重新加载」，点按钮发 retry', async () => {
    const wrapper = mount(ErrorState, { props: { message: '服务暂时不可达（HTTP 502）' } });
    expect(wrapper.text()).toContain('加载失败');
    expect(wrapper.text()).toContain('服务暂时不可达（HTTP 502）');
    const retry = wrapper.get('button');
    expect(retry.text()).toBe('重新加载');
    await retry.trigger('click');
    expect(wrapper.emitted('retry')).toHaveLength(1);
    // 不带 role：页面同时只该有一个 alert，由调用方决定
    expect(wrapper.find('[role="alert"]').exists()).toBe(false);
  });

  it('重试中按钮转圈并禁用；默认插槽追加在「重新加载」之后', () => {
    const wrapper = mount(ErrorState, {
      props: { title: '申请列表加载失败', loading: true },
      slots: { default: () => h('button', { type: 'button' }, '查看系统状态') },
    });
    const [retry, extra] = wrapper.findAll('button');
    expect(retry.attributes('disabled')).toBeDefined();
    expect(extra.text()).toBe('查看系统状态');
    expect(wrapper.text()).toContain('申请列表加载失败');
  });
});
