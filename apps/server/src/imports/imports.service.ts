import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleInit,
  OnModuleDestroy,
  Logger,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ImportRecognitionService } from './import-recognition.service';
import { EXTENSIONS, MIME, draftFrom, normalizeResult, type AiPage } from './import-result';
import { reviewPages, type ReviewPage } from './import-review';
import { config } from '../config';
import { AiConfigService } from '../ai/ai-config.service';
import { maintenance, restoreEvents } from '../common/maintenance';
import {
  aiSuggestionKey,
  importDraftSchema,
  type ImportDraft,
  type ParseResult,
} from '@canglin/shared';

// ImportTaskView 引用的 AI 逐页结果类型一并从这里导出
export type { AiPage } from './import-result';
export interface ImportTaskView {
  id: string;
  filename: string;
  status: 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';
  result?: ParseResult;
  error?: string;
  createdAt: string;
  finishedAt?: string;
  version: number;
  draft?: ImportDraft;
  aiStatus: string;
  aiResult: AiPage[];
  reviewPages: ReviewPage[];
  confirmed: boolean;
  requestId?: number;
  originalAvailable: boolean;
  calls: {
    id: string;
    page: number | null;
    model: string;
    status: string;
    error?: string;
    inputTokens: number | null;
    outputTokens: number | null;
    cost: number | null;
    durationMs: number | null;
    mode: string | null;
    promptVersion: string | null;
  }[];
}
/** 导入任务列表的一行：只给找回 / 继续处理用，不含原件路径、识别结果、草稿与确认快照 */
export interface ImportTaskSummary {
  id: string;
  filename: string;
  createdAt: string;
  finishedAt: string | null;
  status: ImportTaskView['status'];
  aiStatus: string;
  confirmed: boolean;
  requestId?: number;
  confirmedAt: string | null;
  originalAvailable: boolean;
}
/**
 * 导入任务的生命周期与对外接口：上传、串行识别队列、崩溃恢复、取消 / 重试、草稿、确认前校验与原件保留清理。
 * 逐页识别（本地 OCR / AI）与原件读取委托给 ImportRecognitionService。
 */
@Injectable()
export class ImportsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ImportsService.name);
  private retentionTimer?: NodeJS.Timeout;
  private queue: Promise<void> = Promise.resolve();
  private stopped = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aiConfig: AiConfigService,
    private readonly recognition: ImportRecognitionService,
  ) {}

  private restored = () => this.recoverTasks();
  async onModuleInit() {
    restoreEvents.on('restored', this.restored);
    await this.recoverTasks();
    this.retentionTimer = setInterval(() => {
      if (this.stopped || maintenance.locked) return;
      const release = maintenance.enter();
      void this.sweep()
        .catch((error) =>
          this.logger.warn(
            `原件保留清理失败：${error instanceof Error ? error.message : '未知错误'}`,
          ),
        )
        .finally(release);
    }, 6 * 3600_000);
    this.retentionTimer.unref();
  }
  private async recoverTasks() {
    const interruptedAi = await this.prisma.importTask.findMany({
      where: { aiStatus: 'RUNNING', confirmedAt: null },
    });
    await this.prisma.importTask.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'PENDING', error: '正在恢复未完成的本地页面' },
    });
    await this.prisma.importTask.updateMany({
      where: { aiStatus: 'RUNNING' },
      data: { aiStatus: 'FAILED', error: '远程请求结果未知，请人工决定是否重试' },
    });
    await this.prisma.aiCall.updateMany({
      where: { status: 'RUNNING' },
      data: { status: 'UNKNOWN' },
    });
    const pending = await this.prisma.importTask.findMany({
      where: { status: 'PENDING', confirmedAt: null },
    });
    for (const row of pending)
      if (!interruptedAi.some((r) => r.id === row.id))
        this.enqueue(row.id, row.generation, 'auto');
    const aiPending = await this.prisma.importTask.findMany({
      where: { status: 'DONE', aiStatus: 'PENDING', confirmedAt: null },
    });
    for (const row of aiPending) this.enqueue(row.id, row.generation, 'ai');
    // Only pages with no recorded attempt may resume automatically after a crash.
    for (const row of interruptedAi) {
      const pages = normalizeResult(row.result)?.pageCount;
      const attempted = await this.prisma.aiCall.findMany({
        where: { taskId: row.id, generation: row.generation },
        select: { page: true },
      });
      if (!pages && !attempted.length) {
        this.enqueue(row.id, row.generation, 'auto');
        continue;
      }
      const remaining = Array.from({ length: pages ?? 0 }, (_, i) => i + 1).filter(
        (page) => !attempted.some((a) => a.page === page),
      );
      await this.prisma.importTask.updateMany({
        where: { id: row.id, generation: row.generation, confirmedAt: null },
        data: { status: 'DONE' },
      });
      if (remaining.length) {
        await this.prisma.importTask.updateMany({
          where: { id: row.id, generation: row.generation, confirmedAt: null },
          data: { aiStatus: 'PENDING' },
        });
        this.enqueue(row.id, row.generation, 'ai', remaining);
      }
    }
  }
  onModuleDestroy() {
    clearInterval(this.retentionTimer);
    restoreEvents.off('restored', this.restored);
    this.stopped = true;
    this.recognition.stop();
  }
  private enqueue(id: string, generation: number, stage: 'auto' | 'local' | 'ai', pages?: number[]) {
    const epoch = maintenance.epoch;
    this.queue = this.queue
      .then(async () => {
        if (this.stopped || epoch !== maintenance.epoch) return;
        while (maintenance.locked && !this.stopped) await new Promise((r) => setTimeout(r, 100));
        if (this.stopped || epoch !== maintenance.epoch) return;
        const release = maintenance.enter();
        try {
          if (stage === 'auto') {
            if (await this.aiConfig.canImport(await this.aiConfig.getConfig()))
              await this.recognition.runAi(id, generation, pages);
            else {
              await this.prisma.importTask.updateMany({
                where: { id, generation, confirmedAt: null },
                data: { aiStatus: 'DISABLED' },
              });
              await this.recognition.runLocal(id, generation, pages);
            }
          } else if (stage === 'local') await this.recognition.runLocal(id, generation, pages);
          else await this.recognition.runAi(id, generation, pages);
        } catch (error) {
          if (stage !== 'ai')
            await this.prisma.importTask.updateMany({
              where: { id, generation, aiStatus: { in: ['PENDING', 'RUNNING'] }, confirmedAt: null },
              data: { aiStatus: 'FAILED' },
            });
          await this.prisma.importTask
            .updateMany({
              where: { id, generation, confirmedAt: null },
              data: {
                [stage === 'ai' ? 'aiStatus' : 'status']: 'FAILED',
                error: error instanceof Error ? error.message : '处理失败',
              },
            })
            .catch(() => undefined);
        } finally {
          release();
        }
      })
      .catch(() => undefined);
  }
  async upload(
    file: { buffer: Buffer; filename: string; size: number },
    ip?: string,
    continueDuplicate = false,
  ) {
    const filename = path.basename(file.filename || 'upload'),
      ext = path.extname(filename).toLowerCase();
    if (!EXTENSIONS.includes(ext) || file.buffer.length > config.maxUploadBytes)
      throw new BadRequestException('文件类型不支持或超过 30MB');
    await this.sweep();
    const contentHash = createHash('sha256').update(file.buffer).digest('hex');
    // 同内容可能有多个任务：优先最新的未确认任务（可以继续处理），都已确认时取最近确认的
    const duplicate = await this.prisma.importTask.findFirst({
      where: { contentHash },
      orderBy: [{ confirmedAt: { sort: 'desc', nulls: 'first' } }, { createdAt: 'desc' }],
      select: { id: true },
    });
    if (duplicate && !continueDuplicate) return { duplicateTaskId: duplicate.id };
    const id = randomUUID(),
      storagePath = `imports/${id}${ext}`;
    fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
    fs.writeFileSync(path.join(config.uploadsDir, storagePath), file.buffer);
    const auto = await this.aiConfig.canImport(await this.aiConfig.getConfig());
    await this.prisma.importTask.create({
      data: {
        id,
        filename,
        storagePath,
        contentHash,
        status: 'PENDING',
        aiStatus: auto ? 'PENDING' : 'DISABLED',
      },
    });
    await this.audit.log('IMPORT_UPLOAD', { detail: { id, filename }, ip });
    this.enqueue(id, 0, 'auto');
    return { taskId: id, duplicateTaskId: duplicate?.id };
  }
  private async sweep() {
    const stale = await this.prisma.importTask.findMany({
      where: {
        confirmedAt: null,
        createdAt: { lt: new Date(Date.now() - 30 * 86400_000) },
        status: { notIn: ['PENDING', 'RUNNING'] },
        aiStatus: { notIn: ['PENDING', 'RUNNING'] },
      },
    });
    for (const row of stale) {
      const removed = await this.prisma.$transaction(async (tx) => {
        const current = await tx.importTask.findUnique({ where: { id: row.id } });
        if (
          !current ||
          current.confirmedAt ||
          ['PENDING', 'RUNNING'].includes(current.status) ||
          ['PENDING', 'RUNNING'].includes(current.aiStatus)
        )
          return false;
        if (
          current.storagePath &&
          (await tx.attachment.count({ where: { storagePath: current.storagePath } }))
        )
          return false;
        await tx.importRevision.deleteMany({ where: { taskId: row.id } });
        await tx.aiCall.deleteMany({ where: { taskId: row.id } });
        await tx.importTask.delete({ where: { id: row.id } });
        return true;
      });
      if (removed && row.storagePath)
        fs.rmSync(path.join(config.uploadsDir, row.storagePath), { force: true });
    }
  }

  /** 原件与单页图像：读取逻辑在 ImportRecognitionService，控制器与 retry 经由这里调用 */
  async original(id: string) {
    return this.recognition.original(id);
  }
  async page(id: string, page: number) {
    return this.recognition.page(id, page);
  }
  private originalAvailable(storagePath: string | null) {
    return !!storagePath && fs.existsSync(path.join(config.uploadsDir, storagePath));
  }
  private confirmedRequestId(confirmation: string | null) {
    if (!confirmation) return;
    try {
      const value = JSON.parse(confirmation);
      if (value.target === 'WORKFLOW' && Number.isInteger(value.requestId) && value.requestId > 0)
        return value.requestId as number;
    } catch { /* Legacy confirmation snapshots do not necessarily contain a workflow request. */ }
  }
  /** 只读列表：按是否已确认入账（confirmedAt）筛选，不触发识别、重试或清理 */
  async list(confirmed: boolean, page: number, pageSize: number) {
    const where = { confirmedAt: confirmed ? { not: null } : null };
    const [rows, total] = await Promise.all([
      this.prisma.importTask.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          filename: true,
          createdAt: true,
          finishedAt: true,
          status: true,
          aiStatus: true,
          confirmedAt: true,
          confirmation: true,
          storagePath: true,
        },
      }),
      this.prisma.importTask.count({ where }),
    ]);
    const tasks: ImportTaskSummary[] = rows.map((row) => ({
      id: row.id,
      filename: row.filename,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString() ?? null,
      status: row.status as ImportTaskSummary['status'],
      aiStatus: row.aiStatus,
      confirmed: !!row.confirmedAt,
      requestId: this.confirmedRequestId(row.confirmation),
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      originalAvailable: this.originalAvailable(row.storagePath),
    }));
    return { tasks, total, page, pageSize };
  }
  async task(id: string): Promise<ImportTaskView> {
    const row = await this.prisma.importTask.findUnique({ where: { id } });
    if (!row) throw new NotFoundException('任务不存在');
    const result = normalizeResult(row.result);
    const records = await this.prisma.aiCall.findMany({
      where: { taskId: id },
      select: {
        id: true,
        page: true,
        model: true,
        status: true,
        response: true,
        inputTokens: true,
        outputTokens: true,
        cost: true,
        durationMs: true,
        mode: true,
        promptVersion: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    const calls = records.map(({ response, ...call }) => ({
      ...call,
      error: call.status !== 'DONE' && response ? JSON.parse(response).error : undefined,
    }));
    const draft = row.draft
      ? importDraftSchema.parse(JSON.parse(row.draft))
      : result
        ? draftFrom(result)
        : importDraftSchema.parse({ items: [] });
    const aiResult: AiPage[] = row.aiResult ? JSON.parse(row.aiResult) : [];
    return {
      id: row.id,
      filename: row.filename,
      status: row.status as ImportTaskView['status'],
      result,
      error: row.error ?? undefined,
      createdAt: row.createdAt.toISOString(),
      finishedAt: row.finishedAt?.toISOString(),
      version: row.version,
      draft,
      aiStatus: row.aiStatus,
      aiResult,
      reviewPages: reviewPages(result, row.aiStatus, aiResult, draft),
      confirmed: !!row.confirmedAt,
      requestId: this.confirmedRequestId(row.confirmation),
      originalAvailable: this.originalAvailable(row.storagePath),
      calls,
    };
  }
  async saveDraft(id: string, version: number, draft: ImportDraft) {
    const current = await this.task(id);
    if (current.confirmed) throw new ConflictException('该任务已确认');
    const ids = new Set<string>();
    const known = new Map(
      [...(current.result?.items ?? []), ...(current.draft?.items ?? [])].map((i) => [
        i.lineId,
        i.source,
      ]),
    );
    for (const page of current.aiResult)
      for (const item of page.items)
        if (item.lineId && !known.has(item.lineId))
          known.set(item.lineId, { page: page.page, method: 'AI' });
    for (const line of draft.items) {
      line.lineId ||= randomUUID();
      if (ids.has(line.lineId)) throw new BadRequestException('重复的明细标识');
      ids.add(line.lineId);
      line.source = known.get(line.lineId); // client cannot invent source coordinates
    }
    await this.prisma.$transaction(async (tx) => {
      const update = await tx.importTask.updateMany({
        where: { id, version, confirmedAt: null },
        data: { draft: JSON.stringify(draft), version: { increment: 1 } },
      });
      if (!update.count) throw new ConflictException('草稿已在别处更新，请重新载入');
      await tx.importRevision.create({
        data: { taskId: id, kind: 'DRAFT', version: version + 1, snapshot: JSON.stringify(draft) },
      });
    });
    return { version: version + 1 };
  }
  async revisions(id: string) {
    await this.task(id);
    return this.prisma.importRevision.findMany({
      where: { taskId: id },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }
  async retry(id: string, stage: 'local' | 'ai', pages?: number[]) {
    const row = await this.prisma.importTask.findUnique({ where: { id } });
    if (!row || row.confirmedAt) throw new BadRequestException('任务不存在或已确认');
    if (
      row.status === 'RUNNING' ||
      row.status === 'PENDING' ||
      row.aiStatus === 'RUNNING' ||
      row.aiStatus === 'PENDING'
    )
      throw new ConflictException('任务仍在处理中，请先取消');
    await this.original(id);
    if (stage === 'ai' && !(await this.aiConfig.canImport(await this.aiConfig.getConfig())))
      throw new BadRequestException('请配置并检测智能导入能力');
    const generation = row.generation + 1;
    const update = await this.prisma.importTask.updateMany({
      where: { id, generation: row.generation, confirmedAt: null },
      data: {
        generation,
        error: null,
        ...(stage === 'local' ? { aiResult: null } : {}),
        [stage === 'local' ? 'status' : 'aiStatus']: 'PENDING',
      },
    });
    if (!update.count) throw new ConflictException('任务已被重试、取消或确认，请刷新状态');
    this.enqueue(id, generation, stage, pages);
    return { ok: true };
  }
  async cancel(id: string) {
    this.recognition.abort(id);
    const row = await this.prisma.importTask.findUnique({ where: { id } });
    await this.prisma.importTask.updateMany({
      where: { id, confirmedAt: null, generation: row?.generation },
      data: {
        generation: { increment: 1 },
        aiStatus: row?.aiStatus === 'DISABLED' ? 'DISABLED' : 'CANCELLED',
        status: 'DONE',
        error: '已取消后台处理，请核对未完成页面',
      },
    });
    return { ok: true };
  }
  /** Shared source-task checks for the workflow import confirmation (draft version, AI review, page review, original file). */
  async validateConfirmation(tx: Prisma.TransactionClient, input: { taskId?: string; version?: number }) {
    const task = input.taskId
      ? await tx.importTask.findUnique({ where: { id: input.taskId } })
      : null;
    if (input.taskId && !task) throw new NotFoundException('来源任务不存在');
    if (task?.confirmedAt) throw new ConflictException('该任务已经确认，不能重复入账');
    if (
      task &&
      (task.status === 'PENDING' ||
        task.status === 'RUNNING' ||
        task.aiStatus === 'PENDING' ||
        task.aiStatus === 'RUNNING')
    )
      throw new ConflictException('请等待后台处理完成或取消后再确认');
    if (task && input.version !== task.version)
      throw new ConflictException('草稿版本不一致，请重新载入');
    const draft = task?.draft ? importDraftSchema.parse(JSON.parse(task.draft)) : null;
    const local = task ? normalizeResult(task.result) : undefined;
    for (const page of (task?.aiResult ? JSON.parse(task.aiResult) : []) as AiPage[])
      for (const suggestion of page.items) {
        const prior = local?.items.find((i) => i.lineId === suggestion.lineId);
        // Prices and links are recorded when a purchase is registered; only request-line facts need review.
        const critical =
          !prior ||
          prior.itemName !== suggestion.itemName ||
          (prior.spec ?? null) !== (suggestion.spec ?? null) ||
          (prior.unit ?? null) !== (suggestion.unit ?? null) ||
          prior.quantity !== suggestion.quantity;
        if (critical && !draft?.reviewedAi.includes(aiSuggestionKey(suggestion)))
          throw new BadRequestException(
            `请明确处理 AI 对「${suggestion.itemName}」的品名、规格、单位、数量或新增候选建议`,
          );
      }
    if (task) {
      const pending = reviewPages(
        local,
        task.aiStatus,
        task.aiResult ? JSON.parse(task.aiResult) : [],
        draft,
      ).filter((p) => !p.reviewed);
      if (pending.length)
        throw new BadRequestException(
          `第 ${pending[0].page} 页未完成核对：${pending[0].reasons.join('、')}`,
        );
    }
    const source = task?.storagePath
      ? {
          full: path.join(config.uploadsDir, task.storagePath),
          filename: task.filename,
          storagePath: task.storagePath,
          mime: MIME[path.extname(task.storagePath)] || 'application/octet-stream',
        }
      : null;
    if (task && (!source || !fs.existsSync(source.full)))
      throw new BadRequestException('原件缺失，不能确认来源任务');
    return { task, local, draft, source };
  }
}
