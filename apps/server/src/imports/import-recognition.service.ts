import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { OcrClient } from './ocr.client';
import { config } from '../config';
import { AiConfigService } from '../ai/ai-config.service';
import { AiResponseError, LlmClient } from '../ai/llm.client';
import { parsedItemSchema, type ParseResult } from '@canglin/shared';
import {
  MIME,
  AiContractError,
  aiPageSchema,
  checkAiPage,
  checkCatalog,
  checkLinks,
  checkReview,
  draftFrom,
  finishResult,
  mergePage,
  normalizeResult,
  type AiPage,
} from './import-result';
import {
  CATALOG_NOTE,
  RECOGNITION_PROMPT_VERSION,
  RECOGNITION_SYSTEM,
  REVIEW_PROMPT_VERSION,
  REVIEW_SYSTEM,
  STRIPS_NOTE,
  recognitionMessage,
  reviewMessage,
} from '../ai/prompts';

/**
 * 原件识别流水线：本地 OCR（runLocal）与 AI 主识别（runAi：预算检查、可中止的远程请求、失败页回退本地 OCR），
 * 以及原件文件与单页图像的读取。runLocal / runAi 只由 ImportsService 的串行队列调用，排队、恢复、取消与清理都在那边。
 * 每页识别前后用 live(id, generation) 复核任务仍是同一代且未确认：取消 / 重试（generation 递增）或确认后，迟到的结果一律丢弃。
 */
@Injectable()
export class ImportRecognitionService {
  private controllers = new Map<string, AbortController>();
  private stopped = false;
  constructor(
    private readonly prisma: PrismaService,
    private readonly ocr: OcrClient,
    private readonly aiConfig: AiConfigService,
    private readonly llm: LlmClient,
  ) {}

  /** 取消任务时调用：中止该任务进行中的 AI 请求 */
  abort(id: string) {
    this.controllers.get(id)?.abort();
  }
  /** 模块销毁时调用：先让 live() 一律返回 null，再中止所有进行中的 AI 请求 */
  stop() {
    this.stopped = true;
    for (const c of this.controllers.values()) c.abort();
  }
  private async live(id: string, generation: number) {
    if (this.stopped) return null;
    return this.prisma.importTask.findFirst({ where: { id, generation, confirmedAt: null } });
  }
  async original(id: string) {
    const task = await this.prisma.importTask.findUnique({ where: { id } });
    if (!task?.storagePath) throw new NotFoundException('原件不存在');
    const full = path.resolve(config.uploadsDir, task.storagePath);
    if (!full.startsWith(path.resolve(config.uploadsDir) + path.sep) || !fs.existsSync(full))
      throw new NotFoundException('原件文件缺失');
    return {
      full,
      filename: task.filename,
      storagePath: task.storagePath,
      mime: MIME[path.extname(full)] || 'application/octet-stream',
    };
  }
  async page(id: string, page: number) {
    const source = await this.original(id);
    return this.pageInput(fs.readFileSync(source.full), source.filename, page);
  }
  /** Preparing an original image does not require a local OCR model or its service. */
  private async documentInfo(bytes: Buffer, filename: string, previous?: ParseResult) {
    if (previous?.pageCount) return { pageCount: previous.pageCount };
    return path.extname(filename).toLowerCase() === '.pdf'
      ? this.ocr.inspect(bytes, filename)
      : { pageCount: 1 };
  }
  /** 页图统一由 OCR 服务渲染或预处理（照片转正、缩放、转 JPEG）；OCR 服务不可用时图片仍按原图发送，PDF 无法渲染 */
  private async pageInput(bytes: Buffer, filename: string, page: number) {
    const ext = path.extname(filename).toLowerCase();
    const image = ['.png', '.jpg', '.jpeg', '.webp'].includes(ext);
    if (ext !== '.pdf' && page !== 1) throw new BadRequestException('页码超出范围');
    try {
      return await this.ocr.page(bytes, filename, page);
    } catch (error) {
      if (!image) throw error;
      return { bytes, mime: MIME[ext] };
    }
  }
  /** 识别模式的图像：开启分段时长截图切成多张（同一页，自上而下），否则一张；分段失败退回整页 */
  private async recognitionImages(bytes: Buffer, filename: string, page: number) {
    if (config.aiImageStrips && path.extname(filename).toLowerCase() !== '.pdf') {
      try {
        const { mime, images } = await this.ocr.pageStrips(bytes, filename, page);
        return images.map((image) => `data:${mime};base64,${image.toString('base64')}`);
      } catch {
        /* fall back to the whole page */
      }
    }
    const image = await this.pageInput(bytes, filename, page);
    return [`data:${image.mime};base64,${image.bytes.toString('base64')}`];
  }
  async runLocal(id: string, generation: number, requested?: number[]) {
    const row = await this.live(id, generation);
    if (!row) return;
    const source = await this.original(id),
      bytes = fs.readFileSync(source.full);
    const previous = normalizeResult(row.result);
    const info = await this.documentInfo(bytes, source.filename, previous);
    const result: ParseResult = {
      ...previous,
      schemaVersion: 2,
      parserVersion: '3',
      items: previous?.items ?? [],
      warnings: [],
      mode: 'PDF_MIXED',
      pageCount: info.pageCount,
      pages:
        previous?.pages ??
        Array.from({ length: info.pageCount }, (_, i) => ({
          page: i + 1,
          status: 'PENDING' as const,
          mode: 'UNKNOWN',
        })),
    };
    await this.prisma.importTask.updateMany({
      where: { id, generation },
      data: { status: 'RUNNING', result: JSON.stringify(result) },
    });
    const selected =
      requested ?? result.pages!.filter((p) => p.status !== 'DONE').map((p) => p.page);
    for (const page of selected) {
      if (!(await this.live(id, generation))) return;
      if (page < 1 || page > info.pageCount) throw new BadRequestException('页码超出范围');
      try {
        const part = await this.ocr.parse(bytes, source.filename, page);
        if (!(await this.live(id, generation))) return;
        mergePage(result, page, part);
        if (part.parserVersion) result.parserVersion = part.parserVersion;
      } catch (error) {
        result.pages = result.pages!.map((p) =>
          p.page === page
            ? {
                page,
                status: 'FAILED',
                mode: 'UNKNOWN',
                error: error instanceof Error ? error.message : '解析失败',
              }
            : p,
        );
      }
      await this.prisma.importTask.updateMany({
        where: { id, generation, confirmedAt: null },
        data: { result: JSON.stringify(result) },
      });
    }
    finishResult(result);
    await this.prisma.importRevision.upsert({
      where: { taskId_kind_version: { taskId: id, kind: 'LOCAL', version: generation } },
      create: { taskId: id, kind: 'LOCAL', version: generation, snapshot: JSON.stringify(result) },
      update: { snapshot: JSON.stringify(result) },
    });
    await this.prisma.importTask.updateMany({
      where: { id, generation, confirmedAt: null },
      data: {
        status: 'DONE',
        result: JSON.stringify(result),
        finishedAt: new Date(),
        aiStatus: ['PENDING', 'RUNNING'].includes(row.aiStatus) ? 'DISABLED' : row.aiStatus,
      },
    });
    await this.prisma.importTask.updateMany({
      where: { id, generation, draft: null, confirmedAt: null },
      data: { draft: JSON.stringify(draftFrom(result)) },
    });
  }
  async runAi(id: string, generation: number, requested?: number[]) {
    const row = await this.live(id, generation);
    if (!row) return;
    const cfg = await this.aiConfig.getConfig();
    if (!(await this.aiConfig.canImport(cfg))) {
      await this.prisma.importTask.updateMany({
        where: { id, generation },
        data: { aiStatus: 'DISABLED', error: 'AI 配置未就绪，已改用本地 OCR' },
      });
      await this.runLocal(id, generation, requested);
      return;
    }
    const source = await this.original(id),
      bytes = fs.readFileSync(source.full);
    const local = normalizeResult(row.result);
    const info = await this.documentInfo(bytes, source.filename, local);
    const initial = !row.draft;
    const result: ParseResult = {
      ...local,
      schemaVersion: 2,
      parserVersion: 'ai-primary-2',
      mode: local?.mode ?? 'AI_IMAGE',
      items: local?.items ?? [],
      warnings: local?.warnings ?? [],
      pageCount: info.pageCount,
      pages: local?.pages ?? Array.from({ length: info.pageCount }, (_, i) => ({
        page: i + 1, status: 'PENDING' as const, mode: 'UNKNOWN',
      })),
    };
    const previous: AiPage[] = row.aiResult ? JSON.parse(row.aiResult) : [];
    const selected =
      requested ??
      Array.from({ length: info.pageCount }, (_, i) => i + 1).filter(
        (p) => !previous.some((r) => r.page === p),
      );
    if (selected.some((p) => p < 1 || p > info.pageCount))
      throw new BadRequestException('页码超出范围');
    const controller = new AbortController();
    this.controllers.set(id, controller);
    await this.prisma.importTask.updateMany({
      where: { id, generation },
      data: { status: 'RUNNING', aiStatus: 'RUNNING', result: JSON.stringify(result) },
    });
    let failed = false;
    const errors: string[] = [];
    // 品名归一建议的候选：最近的 300 个已有物品（品名 + 规格 + 单位）；目录为空时不附带
    const catalog = (await this.prisma.catalogProduct.findMany({
      select: { name: true, specification: true, unit: true },
      orderBy: { id: 'desc' },
      take: 300,
    })).map((c) => ({ name: c.name, spec: c.specification || null, unit: c.unit || null }));
    for (let i = previous.length - 1; i >= 0; i--)
      if (selected.includes(previous[i].page)) previous.splice(i, 1);
    await this.prisma.importTask.updateMany({
      where: { id, generation },
      data: { aiResult: JSON.stringify(previous) },
    });
    try {
      for (const page of selected) {
        if (!(await this.live(id, generation))) return;
        const cost = await this.prisma.aiCall.aggregate({
          where: {
            createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
          _sum: { cost: true },
        });
        const unknownCost =
          cfg.monthlyBudget != null
            ? await this.prisma.aiCall.count({
                where: {
                  createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
                  cost: null,
                  status: { not: 'NOT_SENT' },
                },
              })
            : 0;
        const budgetBlocked =
          cfg.monthlyBudget != null &&
          (cfg.inputPrice == null ||
            cfg.outputPrice == null ||
            unknownCost > 0 ||
            (cost._sum.cost ?? 0) >= cfg.monthlyBudget);
        // 文本层 PDF 页先取本地网格重建：有物理行走审核模式（AI 只拆分品名规格、判断单位），
        // 没有物理行则把文本层附给识别模式；文本层不可用时按图像识别
        let text: Awaited<ReturnType<OcrClient['textLayer']>> | undefined;
        if (path.extname(source.filename).toLowerCase() === '.pdf')
          try {
            text = await this.ocr.textLayer(bytes, source.filename, page);
          } catch {
            text = undefined;
          }
        if (!(await this.live(id, generation))) return;
        // 本页已有明细（重试）时，只有它们正是文本层的这些物理行（lineId 与原文都对得上）才走审核模式；
        // 旧解析器（v3）同样用 p页-r序号 作 lineId，但指向的行不同，按识别模式重识别，避免建议挂到别的行上
        const existing = result.items.filter((i) => i.source?.page === page);
        const sameRows = existing.every((item) => {
          const row = text?.result.items.find((r) => r.lineId === item.lineId);
          return !!row && (row.source?.rawText ?? row.itemName) === (item.source?.rawText ?? item.itemName);
        });
        const rows = cfg.reviewTextPdf !== false && text?.result.items.length && sameRows ? text.result.items : null;
        const mode = rows ? 'REVIEW' : 'RECOGNITION';
        const callId = randomUUID(),
          start = Date.now(),
          model = cfg.model;
        const catalogSuffix = catalog.length ? '+catalog' : '';
        await this.prisma.aiCall.create({
          data: { id: callId, taskId: id, page, generation, model, status: 'NOT_SENT', mode,
            promptVersion: (rows ? REVIEW_PROMPT_VERSION : RECOGNITION_PROMPT_VERSION) + catalogSuffix },
        });
        let metadata:
          | { usage?: { input: number; output: number }; requestId?: string; incompleteReason?: string }
          | undefined;
        let callStatus = 'NOT_SENT';
        let parsed: z.infer<typeof aiPageSchema> | undefined;
        let detail: string | undefined;
        try {
          if (budgetBlocked)
            throw new BadRequestException('AI 预算已达上限、计价未配置或存在用量未知的调用');
          const images = rows
            ? [await this.pageInput(bytes, source.filename, page)].map((i) => `data:${i.mime};base64,${i.bytes.toString('base64')}`)
            : await this.recognitionImages(bytes, source.filename, page);
          controller.signal.throwIfAborted();
          if (images.length > 1)
            await this.prisma.aiCall.update({ where: { id: callId },
              data: { promptVersion: `${RECOGNITION_PROMPT_VERSION}+strips${catalogSuffix}` } });
          // Persist the dispatch boundary before calling the provider. A crash after it is uncertain.
          await this.prisma.aiCall.update({ where: { id: callId }, data: { status: 'RUNNING' } });
          callStatus = 'RUNNING';
          const response = await this.llm.chat({
            ...(await this.aiConfig.params(cfg, 'import')),
            baseUrl: cfg.baseUrl,
            apiKey: cfg.apiKey,
            model,
            schema: z.toJSONSchema(aiPageSchema),
            // 约每行 80 token，100 行上限再加单据头与警告；推理 token 也计入这个额度
            maxTokens: 12_000,
            timeoutMs: 120_000,
            signal: controller.signal,
            messages: [
              {
                role: 'system',
                content: [rows ? REVIEW_SYSTEM : RECOGNITION_SYSTEM, !rows && images.length > 1 ? STRIPS_NOTE : '',
                  catalog.length ? CATALOG_NOTE : ''].filter(Boolean).join('\n\n'),
              },
              {
                role: 'user',
                content: rows
                  ? reviewMessage({
                      page,
                      templateType: text!.result.templateType ?? null,
                      header: {
                        serialNumber: text!.result.serialNumber ?? null,
                        department: text!.result.department ?? null,
                        handler: text!.result.handler ?? null,
                        requestDate: text!.result.requestDate ?? null,
                      },
                      rows: rows.map((row) => ({
                        lineId: row.lineId!,
                        rawText: row.source?.rawText ?? row.itemName,
                        spec: row.spec ?? null,
                        quantity: row.quantity,
                        unit: row.unit ?? null,
                        unitPrice: row.unitPrice ?? null,
                        amount: row.amount ?? null,
                        purchaseLink: row.purchaseLink ?? null,
                        note: row.note ?? null,
                      })),
                      catalog,
                    })
                  : recognitionMessage({
                      page,
                      pageCount: info.pageCount,
                      templateHint: result.templateType ?? text?.result.templateType ?? null,
                      // 只给定位所需的字段：坐标、置信度与来源对模型是噪音
                      existingRows: result.items
                        .filter((i) => i.source?.page === page)
                        .map((i) => ({ lineId: i.lineId, itemName: i.itemName, spec: i.spec ?? null,
                          quantity: i.quantity, unit: i.unit ?? null })),
                      textLayer: text?.textLayer ?? null,
                      strips: images.length,
                      catalog,
                    }),
                images,
              },
            ],
          });
          metadata = response;
          parsed = aiPageSchema.parse(JSON.parse(response.content ?? ''));
          checkAiPage(parsed, !!rows);
          checkCatalog(parsed, catalog);
          if (rows) checkReview(page, parsed, rows, text!.result);
          else if (text?.textLayer) checkLinks(parsed, text.textLayer);
          const validIds = new Set(
            (rows ?? result.items.filter((i) => i.source?.page === page)).map((i) => i.lineId),
          );
          const used = new Set<string>();
          parsed.items = parsed.items.map((item, i) => {
            const lineId = item.lineId && validIds.has(item.lineId) && !used.has(item.lineId)
              ? item.lineId : `ai-${callId}-${i}`;
            used.add(lineId);
            return { ...item, lineId };
          });
          callStatus = 'DONE';
        } catch (error) {
          failed = true;
          metadata = error instanceof AiResponseError ? (error.metadata ?? metadata) : metadata;
          callStatus =
            callStatus === 'NOT_SENT'
              ? 'NOT_SENT'
              : error instanceof AiResponseError && error.kind === 'UNKNOWN'
                ? 'UNKNOWN'
                : 'FAILED';
          detail =
            error instanceof z.ZodError
              ? 'SCHEMA_ERROR：响应字段不符合识别契约'
              : error instanceof SyntaxError
                ? 'INVALID_JSON：响应不是完整 JSON'
                : error instanceof AiContractError || error instanceof Error
                  ? error.message
                  : '识别失败';
          errors.push(`第 ${page} 页：${detail}`);
        } finally {
          // Account for every completed attempt, including refusal, truncation and invalid JSON.
          const usage = metadata?.usage;
          const cost =
            callStatus === 'NOT_SENT'
              ? 0
              : usage && cfg.inputPrice != null && cfg.outputPrice != null
                ? (usage.input * cfg.inputPrice + usage.output * cfg.outputPrice) / 1_000_000
                : null;
          await this.prisma.aiCall.update({
            where: { id: callId },
            data: {
              status: callStatus,
              response: JSON.stringify(
                detail ? { error: detail, ...(metadata?.incompleteReason ? { reason: metadata.incompleteReason } : {}) } : parsed,
              ),
              requestId: metadata?.requestId,
              inputTokens: usage?.input,
              outputTokens: usage?.output,
              cost,
              durationMs: Date.now() - start,
            },
          });
        }
        if (!(await this.live(id, generation)) || controller.signal.aborted) return;
        const pageMode = rows ? 'AI_REVIEW' : 'AI_IMAGE';
        if (callStatus === 'DONE' && parsed) {
          previous.push({ ...parsed, page, mode });
          if (initial) {
            mergePage(result, page, {
              mode: 'AI_IMAGE',
              ...(parsed.templateType ? { templateType: parsed.templateType } : {}),
              // 审核模式的行就是文本层的物理行：保留它们在页面上的真实坐标
              items: parsed.items.map((item) => parsedItemSchema.parse({
                ...item,
                source: { ...rows?.find((row) => row.lineId === item.lineId)?.source, page, method: 'AI', rawText: item.rawText },
              })),
              warnings: [...(rows ? text!.result.warnings : []), ...parsed.warnings],
              pages: [{ page, status: 'DONE', mode: pageMode }],
              ...Object.fromEntries(
                (['serialNumber', 'department', 'handler', 'requestDate'] as const)
                  .filter((field) => parsed![field] != null)
                  .map((field) => [field, parsed![field]]),
              ),
            });
          } else {
            result.pages = result.pages!.map((p) =>
              p.page === page ? { page, status: 'DONE', mode: pageMode } : p);
          }
        } else {
          try {
            // 文本层已重建出物理行的页面直接采用网格结果，不再渲染 OCR
            const fallback = text?.result.items.length ? text.result : await this.ocr.parse(bytes, source.filename, page);
            if (!(await this.live(id, generation))) return;
            mergePage(result, page, fallback);
            result.warnings.push(text?.result.items.length
              ? `第 ${page} 页 AI 未完成，已使用文本层重建的明细，请核对原件`
              : `第 ${page} 页 AI 未完成，已使用本地 OCR，请核对原件`);
          } catch (error) {
            result.pages = result.pages!.map((p) => p.page === page ? {
              page, status: 'FAILED', mode: 'UNKNOWN',
              error: error instanceof Error ? error.message : 'OCR 备用解析失败',
            } : p);
            result.warnings.push(`第 ${page} 页识别未完成，请人工补录并核对原件`);
          }
        }
        await this.prisma.importTask.updateMany({
          where: { id, generation, confirmedAt: null },
          data: { aiResult: JSON.stringify(previous), result: JSON.stringify(result) },
        });
      }
      finishResult(result);
      await this.prisma.importTask.updateMany({
        where: { id, generation, confirmedAt: null },
        data: {
          status: 'DONE',
          result: JSON.stringify(result),
          finishedAt: new Date(),
          aiStatus: failed || previous.length < info.pageCount ? 'FAILED' : 'DONE',
          error:
            failed || previous.length < info.pageCount
              ? `部分 AI 页面未完成，已尝试本地 OCR，人工补录始终可用。${errors.join('；')}`
              : null,
        },
      });
      await this.prisma.importTask.updateMany({
        where: { id, generation, draft: null, confirmedAt: null },
        data: { draft: JSON.stringify(draftFrom(result)) },
      });
      if (await this.live(id, generation))
        await this.prisma.importRevision.upsert({
          where: { taskId_kind_version: { taskId: id, kind: 'RECOGNITION', version: generation } },
          create: { taskId: id, kind: 'RECOGNITION', version: generation, snapshot: JSON.stringify(result) },
          update: { snapshot: JSON.stringify(result) },
        });
    } finally {
      this.controllers.delete(id);
    }
  }
}
