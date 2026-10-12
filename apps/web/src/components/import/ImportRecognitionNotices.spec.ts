import { describe, expect, it } from 'vitest';
import { mount } from '@vue/test-utils';
import { ref } from 'vue';
import ImportRecognitionNotices from './ImportRecognitionNotices.vue';
import { importTaskKey } from './useImportTask';

function mountNotices(warnings: string[], aiWarnings: string[] = []) {
  const task = ref({ result: { warnings }, aiResult: aiWarnings.length ? [{ page: 1, warnings: aiWarnings }] : [] });
  return mount(ImportRecognitionNotices, {
    global: { provide: { [importTaskKey as symbol]: { task, issuePages: ref([]), reviewedPages: ref([]), reviewed: () => {} } } },
  });
}

describe('ImportRecognitionNotices', () => {
  it('整单提示在前，「第 N 行」的疑点按行号归并', () => {
    const wrapper = mountNotices([
      '第 12 行「墨盒」未识别到数量，请对照原件确认',
      '未识别到经办人，请人工确认',
      '第 4 行备注「三种型号各两个」未能解释为单位，请核对是否需要拆行',
      '第 12 行数量×单价与金额不符，请对照原件',
    ], ['第 2 行可能需要拆成三行']);
    expect(wrapper.findAll('li').map((li) => li.text())).toEqual([
      '未识别到经办人，请人工确认',
      '第 4 行：备注「三种型号各两个」未能解释为单位，请核对是否需要拆行',
      '第 12 行：「墨盒」未识别到数量，请对照原件确认；数量×单价与金额不符，请对照原件',
      'AI 第 1 页：第 2 行可能需要拆成三行',
    ]);
  });

  it('没有警告时不渲染提示块', () => {
    expect(mountNotices([]).find('ul').exists()).toBe(false);
  });
});
