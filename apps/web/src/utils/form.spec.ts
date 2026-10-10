import { describe, expect, it } from 'vitest';
import { workflowVoidSchema } from '@canglin/shared';
import { failureText, issueText } from './form';

/** shared 契约产生的真实 zod 错误：日期不存在 + 原因为空 */
function zodError() {
  const parsed = workflowVoidSchema.safeParse({ date: '2026-02-30', reason: '' });
  if (parsed.success) throw new Error('fixture should fail validation');
  return parsed.error;
}

/** apiError 认的是 axios 错误的形状（isAxiosError + response.data.message） */
function axiosLikeError(message: string | string[], status = 409) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    isAxiosError: true,
    response: { status, data: { message } },
  });
}

describe('issueText', () => {
  it('各条校验原因用「；」连接', () => {
    expect(issueText({ issues: [{ message: '数量必须大于 0' }, { message: '单价不能为负数' }] })).toBe(
      '数量必须大于 0；单价不能为负数',
    );
    expect(issueText({ issues: [] })).toBe('');
  });

  it('直接接受 zod 的 error', () => {
    expect(issueText(zodError())).toBe('日期不存在；请填写原因');
  });
});

describe('failureText', () => {
  it('zod 错误取各条 message，而不是 ZodError 自带的 JSON message', () => {
    const error = zodError();
    expect(failureText(error)).toBe('日期不存在；请填写原因');
    expect(failureText(error)).not.toContain('{');
  });

  it('接口错误交给 apiError：取后端返回的 message，数组同样用「；」连接', () => {
    expect(failureText(axiosLikeError('库存已变化'))).toBe('库存已变化');
    expect(failureText(axiosLikeError(['数量必须大于 0', '单价不能为负数'], 400))).toBe('数量必须大于 0；单价不能为负数');
  });

  it('没有后端说明的接口错误给出状态码；普通 Error 用它的 message', () => {
    const bare = Object.assign(new Error('Request failed'), { isAxiosError: true, response: { status: 502, data: '' } });
    expect(failureText(bare)).toBe('请求失败（502）');
    expect(failureText(new Error('网络中断'))).toBe('网络中断');
    expect(failureText('出错了')).toBe('出错了');
  });

  it('issues 不是数组时不当成校验错误', () => {
    expect(failureText(Object.assign(new Error('其它错误'), { issues: 'x' }))).toBe('其它错误');
  });
});
