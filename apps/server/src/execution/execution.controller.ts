import { InvoiceRecognitionService } from './invoice-recognition.service';
import { readUpload } from '../common/multipart.util';
import { Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import { aiProposalSchema, executionDraftSchema, exceptionActionSchema, exceptionRulesSchema, type AiProposalInput, type ExecutionPayload, type ExceptionActionInput, type ExceptionRules, batchCreateSchema, batchSaveSchema, executionQuerySchema, executionReasonSchema, financialCreateSchema, invoiceAllocationSchema, invoiceSchema, openingSchema, type BatchCreateInput, type BatchSaveInput, type ExecutionQuery, type FinancialCreateInput, type InvoiceAllocationInput, type InvoiceInput, type OpeningInput } from '@canglin/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp, operationId } from '../common/request.util';
import { ExceptionsService } from './exceptions.service';
import { DraftsService } from './drafts.service';
import { BatchesService } from './batches.service';
import { FinanceService } from './finance.service';
import { InvoicesService } from './invoices.service';

const versionSchema = z.object({ version: z.number().int().nonnegative() }).strict();
type Reason = z.infer<typeof executionReasonSchema>;
@Controller('execution')
export class ExecutionController {
  constructor(private readonly recognition: InvoiceRecognitionService, private readonly batches: BatchesService, private readonly finance: FinanceService, private readonly invoices: InvoicesService, private readonly exceptions: ExceptionsService, private readonly drafts: DraftsService) {}
  @Get('demands') demands(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.batches.demands(q); }
  @Get('batches') batchesList(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.batches.list(q); }
  @Get('batches/:id') batch(@Param('id', ParseIntPipe) id: number) { return this.batches.detail(id); }
  @Post('batches') batchCreate(@Body(new ZodValidationPipe(batchCreateSchema)) b: BatchCreateInput, @Req() r: FastifyRequest) { return this.batches.create(b, operationId(r), clientIp(r)); }
  @Patch('batches/:id') batchSave(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(batchSaveSchema)) b: BatchSaveInput, @Req() r: FastifyRequest) { return this.batches.save(id, b, operationId(r), clientIp(r)); }
  @Post('batches/:id/confirm') batchConfirm(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() r: FastifyRequest) { return this.batches.confirm(id, b.version, operationId(r), clientIp(r)); }
  @Post('batches/:id/cancel') batchCancel(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(executionReasonSchema)) b: Reason, @Req() r: FastifyRequest) { return this.batches.cancel(id, b.version, b.reason, operationId(r), clientIp(r)); }
  @Get('batches/:id/export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="procurement-batch.csv"') batchExport(@Param('id', ParseIntPipe) id: number) { return this.batches.export(id); }
  @Get('settlements') settlements(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.finance.settlements(q); }
  @Post('settlements/:id/opening') opening(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(openingSchema)) b: OpeningInput, @Req() r: FastifyRequest) { return this.finance.opening(id, b, operationId(r), clientIp(r)); }
  @Get('financial-records') financialRecords(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.finance.list(q); }
  @Get('financial-records/:id') financialRecord(@Param('id', ParseIntPipe) id: number) { return this.finance.detail(id); }
  @Post('financial-records') financialCreate(@Body(new ZodValidationPipe(financialCreateSchema)) b: FinancialCreateInput, @Req() r: FastifyRequest) { return this.finance.create(b, operationId(r), clientIp(r)); }
  @Post('financial-records/:id/void') financialVoid(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(executionReasonSchema)) b: Reason, @Req() r: FastifyRequest) { return this.finance.void(id, b.version, b.date, b.reason, operationId(r), clientIp(r)); }
  @Post('invoice-recognition') async recognizeInvoice(@Query(new ZodValidationPipe(z.object({ mode: z.enum(['LOCAL', 'AI']).default('LOCAL'), page: z.coerce.number().int().min(1).max(30).default(1) }))) q: { mode: 'LOCAL' | 'AI'; page: number }, @Req() r: FastifyRequest) { const key = operationId(r); return this.recognition.recognize(await readUpload(r), q.mode, q.page, key); }
  @Get('invoices') invoiceList(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.invoices.list(q); }
  @Get('invoices/:id') invoice(@Param('id', ParseIntPipe) id: number) { return this.invoices.detail(id); }
  @Post('invoices') invoiceCreate(@Body(new ZodValidationPipe(invoiceSchema)) b: InvoiceInput, @Req() r: FastifyRequest) { return this.invoices.create(b, operationId(r), clientIp(r)); }
  @Patch('invoices/:id') invoiceSave(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(invoiceSchema.safeExtend({ version: versionSchema.shape.version }))) b: InvoiceInput & { version: number }, @Req() r: FastifyRequest) { return this.invoices.save(id, b, operationId(r), clientIp(r)); }
  @Patch('invoices/:id/allocations') invoiceAllocate(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(invoiceAllocationSchema)) b: InvoiceAllocationInput, @Req() r: FastifyRequest) { return this.invoices.allocate(id, b, operationId(r), clientIp(r)); }
  @Post('invoices/:id/post') invoicePost(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() r: FastifyRequest) { return this.invoices.post(id, b.version, operationId(r), clientIp(r)); }
  @Post('invoices/:id/void') invoiceVoid(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(executionReasonSchema)) b: Reason, @Req() r: FastifyRequest) { return this.invoices.void(id, b.version, b.reason, operationId(r), clientIp(r)); }

  @Get('exceptions') exceptionsList(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.exceptions.list(q); }
  @Get('exceptions/rules') rules() { return this.exceptions.rules(); }
  @Patch('exceptions/rules') rulesSave(@Body(new ZodValidationPipe(exceptionRulesSchema)) b: ExceptionRules, @Req() r: FastifyRequest) { return this.exceptions.saveRules(b, operationId(r), clientIp(r)); }
  @Post('exceptions/action') exceptionAction(@Body(new ZodValidationPipe(exceptionActionSchema)) b: ExceptionActionInput, @Req() r: FastifyRequest) { return this.exceptions.action(b, operationId(r), clientIp(r)); }
  @Get('exceptions/history') exceptionHistory(@Query(new ZodValidationPipe(z.object({ key: z.string().min(1).max(100) }))) q: { key: string }) { return this.exceptions.history(q.key); }
  @Get('monthly-review') monthly(@Query(new ZodValidationPipe(z.object({ month: z.string().regex(/^[1-9]\d{3}-(0[1-9]|1[0-2])$/) }))) q: { month: string }) { return this.exceptions.monthly(q.month); }
  @Get('drafts') draftsList(@Query(new ZodValidationPipe(executionQuerySchema)) q: ExecutionQuery) { return this.drafts.list(q); }
  @Get('drafts/:id/context') draftContext(@Param('id', ParseIntPipe) id: number) { return this.drafts.context(id); }
  @Get('drafts/:id') draft(@Param('id', ParseIntPipe) id: number) { return this.drafts.detail(id); }
  @Post('drafts') draftCreate(@Body(new ZodValidationPipe(executionDraftSchema)) b: { title: string; action: ExecutionPayload }, @Req() r: FastifyRequest) { return this.drafts.create(b, operationId(r), clientIp(r)); }
  @Patch('drafts/:id') draftSave(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(executionDraftSchema.extend({ version: versionSchema.shape.version }))) b: { title: string; action: ExecutionPayload; version: number }, @Req() r: FastifyRequest) { return this.drafts.save(id, b, operationId(r), clientIp(r)); }
  @Post('drafts/:id/recheck') draftRecheck(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() r: FastifyRequest) { return this.drafts.refresh(id, b.version, operationId(r), clientIp(r)); }
  @Post('drafts/:id/execute') draftExecute(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(versionSchema)) b: { version: number }, @Req() r: FastifyRequest) { return this.drafts.execute(id, b.version, operationId(r), clientIp(r)); }
  @Post('drafts/:id/discard') draftDiscard(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(executionReasonSchema)) b: Reason, @Req() r: FastifyRequest) { return this.drafts.discard(id, b.version, b.reason, operationId(r), clientIp(r)); }
  @Post('ai-proposals') aiProposal(@Body(new ZodValidationPipe(aiProposalSchema)) b: AiProposalInput, @Req() r: FastifyRequest) { return this.drafts.propose(b, operationId(r), clientIp(r)); }
}
