import { restoreEvents } from '../common/maintenance';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BackupService } from './backup.service';
import type { AutoBackupConfig } from '@canglin/shared';

const SETTING_KEY = 'autoBackup';
const DEFAULT_CONFIG: AutoBackupConfig = { enabled: false, intervalHours: 24, keepCount: 7 };

/** 定时备份：配置存 Setting 表，动态间隔（setTimeout 循环，改配置即时生效） */
@Injectable()
export class AutoBackupService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AutoBackupService.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly backup: BackupService,
  ) {}

  private restored = async () => {
    this.clear();
    const cfg = await this.getConfig();
    if (cfg.enabled) this.schedule(cfg);
  };

  async onModuleInit(): Promise<void> {
    restoreEvents.on('restored', this.restored);
    // 配置读取失败（如首次启动表尚未就绪）不阻断服务启动
    const cfg = await this.getConfig().catch(() => null);
    if (cfg?.enabled) this.schedule(cfg);
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
    if (cfg.enabled) this.schedule(cfg);
    return cfg;
  }

  private schedule(cfg: AutoBackupConfig): void {
    const ms = cfg.intervalHours * 3600_000;
    this.timer = setTimeout(() => {
      void this.tick(cfg);
    }, ms);
    this.timer.unref();
  }

  private async tick(cfg: AutoBackupConfig): Promise<void> {
    try {
      if (!this.backup.isRestoring()) {
        await this.backup.create();
        this.backup.prune(cfg.keepCount);
        this.logger.log('自动备份完成');
      }
    } catch (e) {
      this.logger.error(`自动备份失败: ${e instanceof Error ? e.message : e}`);
    }
    // 重新加载配置（可能已被修改）
    const latest = await this.getConfig().catch(() => cfg);
    if (latest.enabled) this.schedule(latest);
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  onModuleDestroy(): void {
    restoreEvents.off('restored', this.restored);
    this.clear();
  }
}
