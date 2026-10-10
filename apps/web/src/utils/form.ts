import { apiError } from '@/api/client';

/** 一组校验问题（zod 的 error.issues 这类）→ 一句话，各条原因用「；」连接（与 apiError 合并数组消息的写法一致） */
export function issueText(error: { issues: { message: string }[] }): string {
  return error.issues.map((issue) => issue.message).join('；');
}

/**
 * 弹窗提交失败时给用户看的原因：带 issues 数组的校验错误（zod）取各条 message，
 * 其余（接口错误、网络错误、普通 Error）交给 apiError。
 * ZodError 的 message 是整串 JSON，不能直接交给 apiError。
 */
export function failureText(cause: unknown): string {
  return hasIssues(cause) ? issueText(cause) : apiError(cause);
}

function hasIssues(cause: unknown): cause is { issues: { message: string }[] } {
  return typeof cause === 'object' && cause !== null && Array.isArray((cause as { issues?: unknown }).issues);
}
