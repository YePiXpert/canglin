import { Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { planningQuerySchema, planningId, workflowDateSchema, stocktakeCreateSchema, stocktakeSaveSchema, stocktakeRecountSchema, versionSchema, planningReasonSchema, stockPolicySchema, replenishmentDraftSchema, replenishmentSaveSchema, replenishmentConfirmSchema, followupTargetSchema, followupBatchSchema, type PlanningQuery, type StocktakeCreateInput, type StocktakeSaveInput, type ReplenishmentDraftInput, type ReplenishmentConfirmInput } from '@canglin/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp, operationId } from '../common/request.util';
import { PrismaService } from '../prisma/prisma.service';
import { StocktakeService } from './stocktake.service';
import { ReplenishmentService } from './replenishment.service';
import { FollowupService, type FollowupQuery } from './followup.service';
const policiesSchema = z.object({ items: z.array(z.object({ productId: planningId, policy: stockPolicySchema }).strict()).min(1).max(200).refine(a => new Set(a.map(p => p.productId)).size === a.length, '物品不能重复') }).strict();
const suggestionsSchema = z.object({ excludeDraftId: planningId.optional() });
const followupQuery = planningQuerySchema.extend({ kind: z.enum(['ARRIVAL', 'INVOICE']).optional(), due: z.literal('1').optional(), supplierId: planningId.optional(), requestId: planningId.optional(), dateFrom: workflowDateSchema.optional(), dateTo: workflowDateSchema.optional() }).refine(q => !q.dateFrom || !q.dateTo || q.dateFrom <= q.dateTo, '起始日期不能晚于结束日期');
const historySchema = z.object({ kind: z.enum(['ARRIVAL', 'INVOICE']), targetId: planningId });
const dismissSchema = followupTargetSchema.extend({ dismissed: z.boolean(), reason: z.string().trim().min(1).max(500) }).strict();

@Controller('planning')
export class PlanningController {
  constructor(private readonly prisma: PrismaService, private readonly counts: StocktakeService, private readonly supply: ReplenishmentService, private readonly followups: FollowupService) {}
  @Get('summary') summary() { return this.prisma.$transaction(async tx => ({ draftStocktakes: await tx.stocktake.count({ where: { status: 'DRAFT' } }), needsReplenishment: (await this.supply.suggestionsTx(tx)).filter(r => r.suggested !== '0').length, dueFollowups: (await this.followups.rowsTx(tx)).filter(r => r.due || r.overdue).length })); }
  @Get('counts') countList(@Query(new ZodValidationPipe(planningQuerySchema)) q: PlanningQuery) { return this.counts.list(q); }
  @Get('counts/:id') count(@Param('id', ParseIntPipe) id: number) { return this.counts.detail(id); }
  @Get('counts/:id/export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="stocktake.csv"') countExport(@Param('id', ParseIntPipe) id: number) { return this.counts.export(id); }
  @Post('counts') createCount(@Body(new ZodValidationPipe(stocktakeCreateSchema)) body: StocktakeCreateInput, @Req() req: FastifyRequest) { return this.counts.create(body, operationId(req), clientIp(req)); }
  @Patch('counts/:id') saveCount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(stocktakeSaveSchema)) body: StocktakeSaveInput, @Req() req: FastifyRequest) { return this.counts.save(id, body, operationId(req), clientIp(req)); }
  @Post('counts/:id/recount') recount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(stocktakeRecountSchema)) body: z.infer<typeof stocktakeRecountSchema>, @Req() req: FastifyRequest) { return this.counts.recount(id, body, operationId(req), clientIp(req)); }
  @Post('counts/:id/post') postCount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(versionSchema)) body: { version: number }, @Req() req: FastifyRequest) { return this.counts.post(id, body, operationId(req), clientIp(req)); }
  @Post('counts/:id/cancel') cancelCount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(planningReasonSchema)) body: z.infer<typeof planningReasonSchema>, @Req() req: FastifyRequest) { return this.counts.close(id, body, 'cancel', operationId(req), clientIp(req)); }
  @Post('counts/:id/void') voidCount(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(planningReasonSchema)) body: z.infer<typeof planningReasonSchema>, @Req() req: FastifyRequest) { return this.counts.close(id, body, 'void', operationId(req), clientIp(req)); }
  @Get('replenishment/suggestions') suggestions(@Query(new ZodValidationPipe(suggestionsSchema)) q: z.infer<typeof suggestionsSchema>) { return this.supply.suggestions(q.excludeDraftId); }
  @Patch('replenishment/policies') policies(@Body(new ZodValidationPipe(policiesSchema)) body: z.infer<typeof policiesSchema>, @Req() req: FastifyRequest) { return this.supply.policies(body.items.map(p => ({ productId: p.productId, ...p.policy })), operationId(req), clientIp(req)); }
  @Get('replenishment/drafts') draftList(@Query(new ZodValidationPipe(planningQuerySchema)) q: PlanningQuery) { return this.supply.list(q); }
  @Get('replenishment/drafts/:id') draft(@Param('id', ParseIntPipe) id: number) { return this.supply.detail(id); }
  @Post('replenishment/drafts') createDraft(@Body(new ZodValidationPipe(replenishmentDraftSchema)) body: ReplenishmentDraftInput, @Req() req: FastifyRequest) { return this.supply.save(null, body, operationId(req), clientIp(req)); }
  @Patch('replenishment/drafts/:id') saveDraft(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(replenishmentSaveSchema)) body: ReplenishmentDraftInput & { version: number }, @Req() req: FastifyRequest) { return this.supply.save(id, body, operationId(req), clientIp(req)); }
  @Post('replenishment/drafts/:id/confirm') confirmDraft(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(replenishmentConfirmSchema)) body: ReplenishmentConfirmInput, @Req() req: FastifyRequest) { return this.supply.confirm(id, body, operationId(req), clientIp(req)); }
  @Post('replenishment/drafts/:id/discard') discardDraft(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(planningReasonSchema)) body: z.infer<typeof planningReasonSchema>, @Req() req: FastifyRequest) { return this.supply.discard(id, body, operationId(req), clientIp(req)); }
  @Get('followups') followupList(@Query(new ZodValidationPipe(followupQuery)) q: FollowupQuery) { return this.followups.list(q); }
  @Get('followups/history') history(@Query(new ZodValidationPipe(historySchema)) q: z.infer<typeof historySchema>) { return this.followups.history(q.kind, q.targetId); }
  @Patch('followups/plans') plans(@Body(new ZodValidationPipe(followupBatchSchema)) body: z.infer<typeof followupBatchSchema>, @Req() req: FastifyRequest) { return this.followups.plan(body, operationId(req), clientIp(req)); }
  @Patch('followups/dismiss') dismiss(@Body(new ZodValidationPipe(dismissSchema)) body: z.infer<typeof dismissSchema>, @Req() req: FastifyRequest) { return this.followups.dismiss(body, operationId(req), clientIp(req)); }
}
