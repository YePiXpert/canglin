import { Body, Controller, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import {
  workflowRequestCreateSchema, workflowPurchaseSchema, workflowReceiptSchema, workflowQuerySchema,
  workflowStockInSchema, workflowDistributionSchema, workflowSupplierReturnSchema,
  workflowEmployeeReturnSchema, workflowPurchaseCancelSchema, workflowRequestCancelSchema,
  workflowAdjustmentSchema, workflowVoidSchema, workflowMetadataSchema, workflowProductCreateSchema,
  type WorkflowRequestCreateInput, type WorkflowPurchaseInput, type WorkflowReceiptInput, type WorkflowQuery,
  type WorkflowStockInInput, type WorkflowDistributionInput, type WorkflowSupplierReturnInput,
  type WorkflowEmployeeReturnInput, type WorkflowPurchaseCancelInput, type WorkflowRequestCancelInput,
  type WorkflowAdjustmentInput, type WorkflowVoidInput, type WorkflowMetadataInput, type WorkflowProductCreateInput,
} from '@canglin/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp, operationId } from '../common/request.util';
import { WorkflowService } from './workflow.service';
import { WorkflowQueryService } from './workflow-query.service';

const reportSchema = workflowQuerySchema.and(z.object({ groupBy: z.enum(['month', 'department', 'supplier']).default('month') }));

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService, private readonly queries: WorkflowQueryService) {}

  @Get('requests') requests(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.requests(query); }
  @Get('requests/:id') request(@Param('id', ParseIntPipe) id: number) { return this.queries.request(id); }
  @Get('documents') documents(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.documents(query); }
  @Get('documents/:id') document(@Param('id', ParseIntPipe) id: number) { return this.queries.document(id); }
  @Get('lines/:id/document') lineDocument(@Param('id', ParseIntPipe) id: number) { return this.queries.lineDocument(id); }
  @Get('stock') stock(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.stock(query); }
  @Get('entries') entries(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.entries(query); }
  @Get('overview') overview() { return this.queries.overview(); }
  @Get('prices') prices(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.prices(query); }
  @Get('reports') reports(@Query(new ZodValidationPipe(reportSchema)) query: WorkflowQuery & { groupBy: 'month' | 'department' | 'supplier' }) { return this.queries.reports(query); }

  @Post('requests') createRequest(@Body(new ZodValidationPipe(workflowRequestCreateSchema)) body: WorkflowRequestCreateInput, @Req() req: FastifyRequest) { return this.workflow.createRequest(body, operationId(req), clientIp(req)); }
  @Post('products') createProduct(@Body(new ZodValidationPipe(workflowProductCreateSchema)) body: WorkflowProductCreateInput, @Req() req: FastifyRequest) { return this.workflow.createProduct(body, operationId(req), clientIp(req)); }
  @Post('purchases') purchase(@Body(new ZodValidationPipe(workflowPurchaseSchema)) body: WorkflowPurchaseInput, @Req() req: FastifyRequest) { return this.workflow.purchase(body, operationId(req), clientIp(req)); }
  @Post('receipts') receive(@Body(new ZodValidationPipe(workflowReceiptSchema)) body: WorkflowReceiptInput, @Req() req: FastifyRequest) { return this.workflow.receive(body, operationId(req), clientIp(req)); }
  @Post('stock-in') stockIn(@Body(new ZodValidationPipe(workflowStockInSchema)) body: WorkflowStockInInput, @Req() req: FastifyRequest) { return this.workflow.stockIn(body, operationId(req), clientIp(req)); }
  @Post('distributions') distribute(@Body(new ZodValidationPipe(workflowDistributionSchema)) body: WorkflowDistributionInput, @Req() req: FastifyRequest) { return this.workflow.distribute(body, operationId(req), clientIp(req)); }
  @Post('supplier-returns') supplierReturn(@Body(new ZodValidationPipe(workflowSupplierReturnSchema)) body: WorkflowSupplierReturnInput, @Req() req: FastifyRequest) { return this.workflow.returnToSupplier(body, operationId(req), clientIp(req)); }
  @Post('employee-returns') employeeReturn(@Body(new ZodValidationPipe(workflowEmployeeReturnSchema)) body: WorkflowEmployeeReturnInput, @Req() req: FastifyRequest) { return this.workflow.returnFromRecipient(body, operationId(req), clientIp(req)); }
  @Post('purchase-cancellations') cancelPurchase(@Body(new ZodValidationPipe(workflowPurchaseCancelSchema)) body: WorkflowPurchaseCancelInput, @Req() req: FastifyRequest) { return this.workflow.cancelPurchase(body, operationId(req), clientIp(req)); }
  @Post('request-cancellations') cancelRequest(@Body(new ZodValidationPipe(workflowRequestCancelSchema)) body: WorkflowRequestCancelInput, @Req() req: FastifyRequest) { return this.workflow.cancelRequest(body, operationId(req), clientIp(req)); }
  @Post('adjustments') adjust(@Body(new ZodValidationPipe(workflowAdjustmentSchema)) body: WorkflowAdjustmentInput, @Req() req: FastifyRequest) { return this.workflow.adjust(body, operationId(req), clientIp(req)); }
  @Post('documents/:id/void') void(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowVoidSchema)) body: WorkflowVoidInput, @Req() req: FastifyRequest) { return this.workflow.voidDocument(id, body, operationId(req), clientIp(req)); }
  @Patch('documents/:id/metadata') metadata(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowMetadataSchema)) body: WorkflowMetadataInput, @Req() req: FastifyRequest) { return this.workflow.metadata(id, body, operationId(req), clientIp(req)); }
}
