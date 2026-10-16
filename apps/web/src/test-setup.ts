/**
 * 单测环境（jsdom）补上浏览器有、jsdom 没有的接口：reka 的下拉（Combobox）展开时会把高亮项 scrollIntoView，
 * 弹层定位要 ResizeObserver。只补空实现，不模拟布局。
 */
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = function scrollIntoView() {};
if (!('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  (globalThis as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
}
