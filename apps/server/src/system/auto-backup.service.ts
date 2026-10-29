import { restoreEvents } from '../common/maintenance';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';
import type { AutoBackupConfig } from '@canglin/shared';

const SETTING_KEY = 'autoBackup';
const DEFAULT_CONFIG: AutoBackupConfig = { enabled: true, intervalHours: 24, keepCount: 7 };
/** 启动、恢复或改配置后至少等这么久：避开升级时的健康检查，备份期间接口会短暂维护 */
const SETTLE_MS = 5 * 60_000;
/** 备份失败后隔这么久再试，不连续重试 */
const RETRY_MS = 60 * 60_000;
/** setTimeout 最多约 24.8 天，超过会立即触发；更长的间隔分段等待 */
const MAX_TIMER_MS = 2 ** 31 - 1;

/**
 * 定时备份：配置存 Setting 表，默认开启。按最近一次备份（含手动）满一个间隔排期，
 * 重启或升级不会把下一次推后；改配置即时生效。
 */
@Injectable()
export class AutoBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoBackupService.name);
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
  ) {}

  private restored = async () => {
    this.clear();
    this.schedule(await this.getConfig(), SETTLE_MS);
  };

  async onModuleInit(): Promise<void> {
    restoreEvents.on('restored', this.restored);
    // 配置读取失败（如首次启动表尚未就绪）不阻断服务启动
    const cfg = await this.getConfig().catch(() => null);
    if (cfg) this.schedule(cfg, SETTLE_MS);
  }

  async getConfig(): Promise<AutoBackupConfig> {
    const row = await this.prisma.setting.findUnique({ where: { key: SETTING_KEY } });
    if (!row) return DEFAULT_CONFIG;
    try {
      return { ...DEFAULT_CONFIG, ...(JSON.parse(row.value) as AutoBackupConfig) };
    } catch {
      return DEFAULT_CONFIG;
    }
  }

  async updateConfig(cfg: AutoBackupConfig): Promise<AutoBackupConfig> {
    await this.prisma.setting.upsert({
      where: { key: SETTING_KEY },
      create: { key: SETTING_KEY, value: JSON.stringify(cfg) },
      update: { value: JSON.stringify(cfg) },
    });
    this.clear();
    this.schedule(cfg, SETTLE_MS);
    return cfg;
  }

  /** 到期时间：最近一次备份之后满一个间隔；还没有备份（或读不到备份目录）时立即到期 */
  private due(cfg: AutoBackupConfig): number {
    let last: string | undefined;
    try {
      last = this.backup.list()[0]?.createdAt;
    } catch {
      /* 按没有备份处理 */
    }
    return last ? Date.parse(last) + cfg.intervalHours * 3600_000 : Date.now();
  }

  private schedule(cfg: AutoBackupConfig, wait = 0): void {
    if (this.stopped) return;
    if (!cfg.enabled) {
      this.logger.log('自动备份未开启');
      return;
    }
    const at = Math.max(this.due(cfg), Date.now() + wait);
    this.timer = setTimeout(() => {
      void this.tick(cfg);
    }, Math.min(at - Date.now(), MAX_TIMER_MS));
    this.timer.unref();
    this.logger.log(`自动备份：每 ${cfg.intervalHours} 小时，保留 ${cfg.keepCount} 份，下次约 ${new Date(at).toLocaleString('zh-CN', { hour12: false })}`);
  }

  private async tick(cfg: AutoBackupConfig): Promise<void> {
    this.timer = null;
    // 重新加载配置（可能已被修改）
    const latest = await this.getConfig().catch(() => cfg);
    if (!latest.enabled) return;
    let wait = 0;
    try {
      if (this.backup.isRestoring()) wait = SETTLE_MS;
      // 长间隔分段等待时可能还没到期
      else if (this.due(latest) <= Date.now()) {
        await this.backup.create();
        this.backup.prune(latest.keepCount);
        this.logger.log('自动备份完成');
      }
    } catch (e) {
      wait = RETRY_MS;
      this.logger.error(`自动备份失败，1 小时后重试: ${e instanceof Error ? e.message : e}`);
    }
    if (!this.timer) this.schedule(latest, wait);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    restoreEvents.off('restored', this.restored);
    this.clear();
  }
}
