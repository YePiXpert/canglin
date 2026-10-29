import { describe, expect, it } from 'vitest';
import { parseAllowedModels } from '../src/config';

describe('LLM_ALLOWED_MODELS 解析', () => {
  it('未设置、空串、只有分隔符和 * 都不限制', () => {
    expect(parseAllowedModels(undefined)).toBeNull();
    expect(parseAllowedModels('')).toBeNull();
    expect(parseAllowedModels(' , ,')).toBeNull();
    expect(parseAllowedModels(' * ')).toBeNull();
  });

  it('去空格、去空项、去重，用 id 当显示名', () => {
    expect(parseAllowedModels('grok-4.7, house-model,,house-model , gpt-6.1-sol')).toEqual([
      { id: 'grok-4.7', label: 'grok-4.7' },
      { id: 'house-model', label: 'house-model' },
      { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol' },
    ]);
  });
});
