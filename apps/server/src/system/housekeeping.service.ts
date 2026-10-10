import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { maintenance } from '../common/maintenance';
import { PrismaService } from '../prisma/prisma.service';
import { StockReconcileService } from '../workflow/stock-reconcile.service';

/** Idempotency receipts only need to outlive realistic client retries; 90 days is far beyond that. */
export const RECEIPT_RETENTION_DAYS = 90;

interface Job {
  label: string;
  run: () => Promise<unknown>;
}

/**
 * Daily background jobs, run at 03:00 in the server time zone (TZ). Each job holds an admission ticket
 * while running so a backup/restore waits for it. A job that finds a backup/restore holding the
 * maintenance lock is not skipped for the day: it and the jobs after it are retried every
 * `retryDelayMs`, at most `retryAttempts` times, and otherwise wait for the next daily run.
 */
@Injectable()
export class HousekeepingService implements OnModuleDestroy {
  private readonly logger = new Logger(HousekeepingService.name);
  /** Delay between retries while the maintenance lock is held; tests shorten it. */
  retryDelayMs = 15 * 60_000;
  /** Retries before the remaining jobs give up until the next daily run. */
  retryAttempts = 4;
  private retryTimer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly stock: StockReconcileService,
  ) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM, { name: 'housekeeping' })
  async daily(): Promise<void> {
    // A new run covers every job, so a retry still pending from an earlier run is dropped.
    this.cancelRetry();
    await this.run(
      [
        { label: '清理操作回执', run: () => this.pruneReceipts() },
        { label: '库存对账', run: () => this.stock.reconcile() },
      ],
      this.retryAttempts,
    );
  }

  /** Deletes OperationReceipt rows older than the retention window; returns the number removed. */
  async pruneReceipts(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RECEIPT_RETENTION_DAYS * 86400_000);
    const { count } = await this.prisma.operationReceipt.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (count) this.logger.log(`已清理 ${count} 条超过 ${RECEIPT_RETENTION_DAYS} 天的操作回执`);
    return count;
  }

  onModuleDestroy(): void {
    this.stopped = true;
    this.cancelRetry();
  }

  /** Runs the jobs in order; from the first one that meets the maintenance lock on, the rest is deferred. */
  private async run(jobs: Job[], retriesLeft: number): Promise<void> {
    for (const [index, job] of jobs.entries()) {
      if (this.stopped) return;
      if (!(await this.guarded(job))) return this.defer(jobs.slice(index), retriesLeft);
    }
  }

  private defer(jobs: Job[], retriesLeft: number): void {
    if (this.stopped) return;
    const labels = jobs.map((job) => job.label).join('、');
    if (retriesLeft <= 0) {
      this.logger.warn(`备份/恢复维护持续进行，${labels}今日不再重试`);
      return;
    }
    this.logger.log(`备份/恢复维护中，${labels}稍后重试（剩余 ${retriesLeft} 次）`);
    // unref: a pending retry never keeps the process (or a test run) alive.
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.run(jobs, retriesLeft - 1);
    }, this.retryDelayMs);
    this.retryTimer.unref();
  }

  private cancelRetry(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
  }

  /** Runs one job under an admission ticket; returns false, without running it, while the lock is held. */
  private async guarded(job: Job): Promise<boolean> {
    if (maintenance.locked) return false;
    const release = maintenance.enter();
    try {
      await job.run();
    } catch (error) {
      this.logger.warn(`${job.label}失败：${error instanceof Error ? error.message : '未知错误'}`);
    } finally {
      release();
    }
    return true;
  }
}
