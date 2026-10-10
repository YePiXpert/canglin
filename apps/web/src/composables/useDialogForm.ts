import { computed, ref } from 'vue';
import { failureText } from '@/utils/form';

/**
 * 表单弹窗的共用状态（DESIGN.md §6「表单」）：保存中、提交失败的原因、字段错误、有没有未保存的改动。
 *
 * - snapshot：返回表单当前内容的可比较快照，通常是 () => JSON.stringify(form)；
 *   只想让部分字段算「改动」时就只拼那部分（如撤销登记只看原因：() => form.reason.trim()）。
 * - reset()：弹窗打开、填好初始值之后调用——清空 errors / failure，把当前快照记为「干净」。
 * - dirty：当前快照与干净快照不同；交给 Dialog 时写 :dirty="dirty && !saving"、:persistent="saving"。
 * - submit(run)：保存中再点直接忽略（返回 undefined、不调用 run）；否则清空 failure 并等待 run()：
 *   成功就把当前快照记为干净（随后关闭弹窗不会再问「放弃修改」）并返回 run 的结果；
 *   失败就把 failure 设为 failureText(错误)（zod 校验错误或接口错误）并返回 undefined。
 *   字段级校验（errors）由调用方在 submit 之前做完。
 */
export function useDialogForm(snapshot: () => string) {
  const saving = ref(false);
  const failure = ref('');
  const errors = ref<Record<string, string>>({});
  const initial = ref(snapshot());
  const dirty = computed(() => snapshot() !== initial.value);

  function reset(): void {
    errors.value = {};
    failure.value = '';
    initial.value = snapshot();
  }

  async function submit<T>(run: () => Promise<T>): Promise<T | undefined> {
    if (saving.value) return undefined;
    saving.value = true;
    failure.value = '';
    try {
      const result = await run();
      initial.value = snapshot();
      return result;
    } catch (cause) {
      failure.value = failureText(cause);
      return undefined;
    } finally {
      saving.value = false;
    }
  }

  return { saving, failure, errors, dirty, reset, submit };
}
