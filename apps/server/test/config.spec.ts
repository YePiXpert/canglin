import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_MODELS } from '@canglin/shared';
import { parseAllowedModels } from '../src/config';

describe('LLM_ALLOWED_MODELS 解析', () => {
  it('未设置、空串、只有分隔符都用默认的三个；* 不限制', () => {
    expect(parseAllowedModels(undefined)).toEqual(DEFAULT_AI_MODELS);
    expect(parseAllowedModels('')).toEqual(DEFAULT_AI_MODELS);
    expect(parseAllowedModels(' , ,')).toEqual(DEFAULT_AI_MODELS);
    expect(parseAllowedModels(' * ')).toBeNull();
  });

  it('去空格、去空项、去重；已知模型沿用显示名与固定推理强度，其它用 id 当显示名', () => {
    expect(parseAllowedModels('grok-4.7, house-model,,house-model , gpt-6.1-sol')).toEqual([
      { id: 'grok-4.7', label: 'grok-4.7' },
      { id: 'house-model', label: 'house-model' },
      { id: 'gpt-6.1-sol', label: 'gpt-6.1-sol（中等思考）', reasoningEffort: 'medium' },
    ]);
  });
});
