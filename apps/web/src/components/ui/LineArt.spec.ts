import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import LineArt from './LineArt.vue';
import { LINE_ART, type ArtShape } from './art';

describe('LineArt', () => {
  it('高度按视窗比例算；纯装饰（aria-hidden），主线跟 currentColor，描边不随尺寸缩放', () => {
    const scene = mount(LineArt, { props: { name: 'granary-scene', size: 340 } }).get('svg');
    expect(scene.attributes('viewBox')).toBe('0 0 320 200');
    expect(scene.attributes('height')).toBe('213');
    expect(scene.attributes('aria-hidden')).toBe('true');
    expect(scene.attributes('stroke')).toBe('currentColor');
    const ledger = mount(LineArt, { props: { name: 'ledger', size: 96 } });
    expect(ledger.get('svg').attributes('viewBox')).toBe('0 0 120 96');
    expect(ledger.get('svg').attributes('height')).toBe('77');
    expect(ledger.findAll('path').every((p) => p.attributes('vector-effect') === 'non-scaling-stroke')).toBe(true);
  });

  it('按绘制顺序画：填充换成令牌类，淡色先垫一层纸面；朱砂、细线、虚线各用各的类', () => {
    const wrapper = mount(LineArt, { props: { name: 'rest' } });
    const shapes: ArtShape[] = LINE_ART.rest.shapes;
    const paths = wrapper.findAll('path');
    const tinted = shapes.filter((s) => s.fill === 'teal' || s.fill === 'amber').length;
    expect(paths).toHaveLength(shapes.length + tinted);
    const leaf = paths.findIndex((p) => p.classes('fill-teal-soft'));
    expect(paths[leaf - 1].classes()).toEqual(expect.arrayContaining(['fill-surface', 'stroke-none']));
    expect(paths.some((p) => p.classes('fill-accent') && p.classes('stroke-accent'))).toBe(true);
    expect(paths.some((p) => p.classes('fill-surface-2') && p.classes('stroke-current'))).toBe(true);
    expect(paths.some((p) => p.classes('fill-none') && p.classes('stroke-line-strong'))).toBe(true);
    const shelf = mount(LineArt, { props: { name: 'shelf' } }).findAll('path');
    expect(shelf.filter((p) => p.attributes('stroke-dasharray') === '3 4')).toHaveLength(1);
  });

  it('每幅至多一处朱砂', () => {
    for (const [name, def] of Object.entries(LINE_ART)) {
      const shapes: ArtShape[] = def.shapes;
      expect(shapes.filter((s) => s.fill === 'accent' || s.stroke === 'accent').length, name).toBeLessThanOrEqual(1);
    }
  });
});
