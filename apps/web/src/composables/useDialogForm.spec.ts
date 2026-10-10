import { describe, expect, it, vi } from 'vitest';
import { reactive } from 'vue';
import { workflowVoidSchema } from '@procure-lite/shared';
import { useDialogForm } from './useDialogForm';

function setup(initial = { reason: '' }) {
  const form = reactive({ ...initial });
  return { form, ...useDialogForm(() => JSON.stringify(form)) };
}

/** 手动结算的 Promise：用来观察 run() 进行中的状态 */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useDialogForm', () => {
  it('reset 清空错误与失败原因，并把当前内容记为干净快照', () => {
    const { form, dirty, errors, failure, reset } = setup();
    expect(dirty.value).toBe(false);
    form.reason = '盘点差异';
    expect(dirty.value).toBe(true);
    errors.value = { reason: '请填写原因' };
    failure.value = '库存已变化';
    reset();
    expect(dirty.value).toBe(false);
    expect(errors.value).toEqual({});
    expect(failure.value).toBe('');
    form.reason = '';
    expect(dirty.value).toBe(true);
  });

  it('保存中再次提交直接忽略：不调用 run，返回 undefined', async () => {
    const { saving, submit } = setup();
    const pending = deferred<string>();
    const run = vi.fn(() => pending.promise);
    const first = submit(run);
    expect(saving.value).toBe(true);
    const second = vi.fn(() => Promise.resolve('second'));
    await expect(submit(second)).resolves.toBeUndefined();
    expect(second).not.toHaveBeenCalled();
    pending.resolve('done');
    await expect(first).resolves.toBe('done');
    expect(run).toHaveBeenCalledOnce();
    expect(saving.value).toBe(false);
  });

  it('成功：清掉上次的失败原因，返回 run 的结果，并把提交时的内容记为干净', async () => {
    const { form, dirty, failure, saving, submit } = setup();
    failure.value = '上次的失败';
    form.reason = '盘点差异';
    expect(dirty.value).toBe(true);
    const pending = deferred<{ id: number }>();
    const result = submit(() => pending.promise);
    expect(failure.value).toBe('');
    expect(saving.value).toBe(true);
    pending.resolve({ id: 7 });
    await expect(result).resolves.toEqual({ id: 7 });
    expect(saving.value).toBe(false);
    expect(dirty.value).toBe(false);
  });

  it('失败：failure 是接口错误的原因，内容仍算未保存，saving 复位', async () => {
    const { form, dirty, failure, saving, submit } = setup();
    form.reason = '盘点差异';
    await expect(submit(() => Promise.reject(new Error('库存已变化')))).resolves.toBeUndefined();
    expect(failure.value).toBe('库存已变化');
    expect(saving.value).toBe(false);
    expect(dirty.value).toBe(true);
  });

  it('run 里抛出的 zod 校验错误显示为各条原因', async () => {
    const { failure, submit } = setup();
    await submit(async () => workflowVoidSchema.parse({ date: '2026-02-30', reason: '' }));
    expect(failure.value).toBe('日期不存在；请填写原因');
  });
});
