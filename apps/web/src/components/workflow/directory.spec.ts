import { describe, expect, it } from 'vitest';
import type { WorkflowDirectory } from '@canglin/shared';
import { lastDepartment, normalizeName, personOptions, similarName } from './directory';

const directory: WorkflowDirectory = {
  departments: [{ name: '行政管理部（党委办公室）', uses: 3, lastDate: '2026-10-09' }, { name: '财务部', uses: 1, lastDate: '2026-10-01' }],
  people: [
    { name: '李雷', department: '财务部', uses: 1, lastDate: '2026-10-09' },
    { name: '王晓敏', department: '行政管理部（党委办公室）', uses: 2, lastDate: '2026-10-08' },
    { name: '李雷', department: '行政管理部（党委办公室）', uses: 4, lastDate: '2026-09-01' },
    { name: '周九', department: '', uses: 1, lastDate: '2026-08-01' },
  ],
  recent: [],
};

describe('部门与人员候选（docs/manual-entry-2026-10.md P1–P4）', () => {
  it('名称归一：全角半角、空白与大小写不计', () => {
    expect(normalizeName(' 行政管理部(党委 办公室) ')).toBe(normalizeName('行政管理部（党委办公室）'));
    expect(normalizeName('ＩＴ部')).toBe('it部');
  });

  it('人员下拉：同名合成一条，小字写用过的部门（最近的在前）；已填部门时这个部门的人在前', () => {
    expect(personOptions(directory)).toEqual([
      { value: '李雷', note: '财务部、行政管理部（党委办公室）' },
      { value: '王晓敏', note: '行政管理部（党委办公室）' },
      { value: '周九', note: undefined },
    ]);
    expect(personOptions(directory, '行政管理部(党委办公室)').map((o) => o.value)).toEqual(['李雷', '王晓敏', '周九']);
    expect(personOptions(directory, '财务部').map((o) => o.value)).toEqual(['李雷', '王晓敏', '周九']);
    expect(personOptions(null)).toEqual([]);
  });

  it('带出部门：用他最近一次写了部门的那条；没出现过、从没写过部门时没有', () => {
    expect(lastDepartment(directory, '李雷')).toBe('财务部');
    expect(lastDepartment(directory, ' 王晓敏 ')).toBe('行政管理部（党委办公室）');
    expect(lastDepartment(directory, '周九')).toBeUndefined();
    expect(lastDepartment(directory, '新来的')).toBeUndefined();
    expect(lastDepartment(directory, '')).toBeUndefined();
  });

  it('写法相近：归一后相同给已有写法；部门另认唯一的开头（至少两个字），人名不认开头；本来就有的不提示', () => {
    const departments = directory.departments.map((d) => d.name);
    expect(similarName('行政管理部(党委办公室)', departments)).toBe('行政管理部（党委办公室）');
    expect(similarName('行政管理部', departments)).toBeUndefined();
    expect(similarName('行政管理部', departments, { prefix: true })).toBe('行政管理部（党委办公室）');
    expect(similarName('财', departments, { prefix: true })).toBeUndefined();
    expect(similarName('财务部', departments, { prefix: true })).toBeUndefined();
    expect(similarName('部', [...departments, '部长办'], { prefix: true })).toBeUndefined();
    expect(similarName('李 雷', ['李雷', '李雷鸣'])).toBe('李雷');
    expect(similarName('李', ['李雷'])).toBeUndefined();
  });
});
