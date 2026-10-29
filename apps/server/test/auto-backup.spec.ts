import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import type { AutoBackupConfig } from '@canglin/shared';
import { AutoBackupService } from '../src/system/auto-backup.service';

const HOUR = 3600_000;
let service: AutoBackupService;

function start(backups: string[], stored?: AutoBackupConfig, fail = false) {
  const settings = new Map(stored ? [['autoBackup', JSON.stringify(stored)]] : []);
  const prisma = { setting: { findUnique: async ({ where }: { where: { key: string } }) => (settings.has(where.key) ? { key: where.key, value: settings.get(where.key)! } : null) } };
  const backup = {
    list: () => [...backups].sort().reverse().map((createdAt) => ({ name: 'backup.zip', sizeBytes: 1, createdAt })),
    create: vi.fn(async () => {
      if (fail) throw new Error('磁盘已满');
      backups.push(new Date().toISOString());
    }),
    prune: vi.fn(),
    isRestoring: () => false,
  };
  service = new AutoBackupService(prisma as never, backup as never);
  return backup;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-29T08:00:00Z'));
  vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  service.onModuleDestroy();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('自动备份', () => {
  it('默认开启：每 24 小时、保留 7 份；还没有备份时启动 5 分钟后做第一份', async () => {
    const backup = start([]);
    expect(await service.getConfig()).toEqual({ enabled: true, intervalHours: 24, keepCount: 7 });
    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(5 * 60_000 - 1);
    expect(backup.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(backup.create).toHaveBeenCalledTimes(1);
    expect(backup.prune).toHaveBeenCalledWith(7);
    await vi.advanceTimersByTimeAsync(24 * HOUR);
    expect(backup.create).toHaveBeenCalledTimes(2);
  });

  it('按最近一次备份排期，重启或升级不会把下一次推后', async () => {
    const backup = start(['2026-10-28T20:00:00.000Z']);
    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(12 * HOUR - 1);
    expect(backup.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(backup.create).toHaveBeenCalledTimes(1);
  });

  it('保存过关闭的不备份；超过 24.8 天的间隔分段等待，不会一启动就连续备份', async () => {
    const off = start([], { enabled: false, intervalHours: 24, keepCount: 7 });
    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(48 * HOUR);
    expect(off.create).not.toHaveBeenCalled();
    service.onModuleDestroy();

    const monthly = start([new Date().toISOString()], { enabled: true, intervalHours: 720, keepCount: 3 });
    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(720 * HOUR - 1);
    expect(monthly.create).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(monthly.create).toHaveBeenCalledTimes(1);
  });

  it('备份失败一小时后再试，不连续重试', async () => {
    const backup = start([], undefined, true);
    await service.onModuleInit();
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(backup.create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(HOUR - 1);
    expect(backup.create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(backup.create).toHaveBeenCalledTimes(2);
  });
});
