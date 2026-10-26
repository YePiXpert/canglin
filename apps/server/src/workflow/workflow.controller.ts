import { Body, Controller, Get, Header, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import type { FastifyRequest } from 'fastify';
import {
  workflowRequestCreateSchema, workflowPurchaseSchema, workflowPurchaseRegistrationSchema, type WorkflowPurchaseRegistrationInput, workflowPurchaseUpdateSchema, type WorkflowPurchaseUpdateInput, workflowReceiptSchema, workflowReceiptUpdateSchema, type WorkflowReceiptUpdateInput, workflowQuerySchema,
  workflowStockInSchema, workflowDistributionSchema, workflowSupplierReturnSchema,
  workflowEmployeeReturnSchema, workflowPurchaseCancelSchema, workflowRequestCancelSchema,
  workflowAdjustmentSchema, workflowVoidSchema, workflowMetadataSchema, workflowProductCreateSchema,
  workflowProductUpdateSchema, type WorkflowProductUpdateInput,
  workflowLinkUpdateSchema, workflowRequestUpdateSchema, type WorkflowLinkUpdateInput, type WorkflowRequestUpdateInput,
  type WorkflowRequestCreateInput, type WorkflowPurchaseInput, type WorkflowReceiptInput, type WorkflowQuery,
  type WorkflowStockInInput, type WorkflowDistributionInput, type WorkflowSupplierReturnInput,
  type WorkflowEmployeeReturnInput, type WorkflowPurchaseCancelInput, type WorkflowRequestCancelInput,
  type WorkflowAdjustmentInput, type WorkflowVoidInput, type WorkflowMetadataInput, type WorkflowProductCreateInput,
  paymentQuerySchema, paymentBatchSchema, type PaymentQuery, type PaymentBatchInput,
} from '@canglin/shared';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp, operationId } from '../common/request.util';
import { WorkflowService } from './workflow.service';
import { WorkflowQueryService } from './workflow-query.service';
import { PaymentsQueryService } from './payments-query.service';

const reportSchema = workflowQuerySchema.and(z.object({ groupBy: z.enum(['month', 'department', 'supplier']).default('month') }));

@Controller('workflow')
export class WorkflowController {
  constructor(private readonly workflow: WorkflowService, private readonly queries: WorkflowQueryService, private readonly payments: PaymentsQueryService) {}

  @Get('payments') paymentList(@Query(new ZodValidationPipe(paymentQuerySchema)) query: PaymentQuery) { return this.payments.list(query); }
  @Get('payments/summary') paymentSummary() { return this.payments.summary(); }
  @Get('payments/export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="payments.csv"')
  paymentExport(@Query(new ZodValidationPipe(paymentQuerySchema)) query: PaymentQuery) { return this.payments.export(query); }
  @Patch('payments/batch') paymentBatch(@Body(new ZodValidationPipe(paymentBatchSchema)) body: PaymentBatchInput, @Req() req: FastifyRequest) { return this.workflow.paymentBatch(body, operationId(req), clientIp(req)); }

  @Get('requests') requests(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.requests(query); }
  @Get('requests/:id') request(@Param('id', ParseIntPipe) id: number) { return this.queries.request(id); }
  @Get('documents') documents(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.documents(query); }
  @Get('documents/:id') document(@Param('id', ParseIntPipe) id: number) { return this.queries.document(id); }
  @Get('lines/:id/document') lineDocument(@Param('id', ParseIntPipe) id: number) { return this.queries.lineDocument(id); }
  @Get('products') products() { return this.queries.products(); }
  @Get('products/:id') product(@Param('id', ParseIntPipe) id: number) { return this.queries.product(id); }
  @Patch('products/:id') updateProduct(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowProductUpdateSchema)) body: WorkflowProductUpdateInput, @Req() req: FastifyRequest) { return this.workflow.updateProduct(id, body, operationId(req), clientIp(req)); }
  @Get('directory') directory() { return this.queries.directory(); }
  @Get('stock') stock(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.stock(query); }
  @Get('entries') entries(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.entries(query); }
  @Get('overview') overview() { return this.queries.overview(); }
  @Get('prices') prices(@Query(new ZodValidationPipe(workflowQuerySchema)) query: WorkflowQuery) { return this.queries.prices(query); }
  @Get('reports') reports(@Query(new ZodValidationPipe(reportSchema)) query: WorkflowQuery & { groupBy: 'month' | 'department' | 'supplier' }) { return this.queries.reports(query); }

  @Post('requests') createRequest(@Body(new ZodValidationPipe(workflowRequestCreateSchema)) body: WorkflowRequestCreateInput, @Req() req: FastifyRequest) { return this.workflow.createRequest(body, operationId(req), clientIp(req)); }
  @Post('products') createProduct(@Body(new ZodValidationPipe(workflowProductCreateSchema)) body: WorkflowProductCreateInput, @Req() req: FastifyRequest) { return this.workflow.createProduct(body, operationId(req), clientIp(req)); }
  @Post('purchases') purchase(@Body(new ZodValidationPipe(workflowPurchaseSchema)) body: WorkflowPurchaseInput, @Req() req: FastifyRequest) { return this.workflow.purchase(body, operationId(req), clientIp(req)); }
  @Post('purchases/register') registerPurchases(@Body(new ZodValidationPipe(workflowPurchaseRegistrationSchema)) body: WorkflowPurchaseRegistrationInput, @Req() req: FastifyRequest) { return this.workflow.registerPurchases(body, operationId(req), clientIp(req)); }
  @Patch('purchases/:id') updatePurchase(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowPurchaseUpdateSchema)) body: WorkflowPurchaseUpdateInput, @Req() req: FastifyRequest) { return this.workflow.updatePurchase(id, body, operationId(req), clientIp(req)); }
  @Post('receipts') receive(@Body(new ZodValidationPipe(workflowReceiptSchema)) body: WorkflowReceiptInput, @Req() req: FastifyRequest) { return this.workflow.receive(body, operationId(req), clientIp(req)); }
  @Patch('receipts/:id') updateReceipt(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowReceiptUpdateSchema)) body: WorkflowReceiptUpdateInput, @Req() req: FastifyRequest) { return this.workflow.updateReceipt(id, body, operationId(req), clientIp(req)); }
  @Post('stock-in') stockIn(@Body(new ZodValidationPipe(workflowStockInSchema)) body: WorkflowStockInInput, @Req() req: FastifyRequest) { return this.workflow.stockIn(body, operationId(req), clientIp(req)); }
  @Post('distributions') distribute(@Body(new ZodValidationPipe(workflowDistributionSchema)) body: WorkflowDistributionInput, @Req() req: FastifyRequest) { return this.workflow.distribute(body, operationId(req), clientIp(req)); }
  @Post('supplier-returns') supplierReturn(@Body(new ZodValidationPipe(workflowSupplierReturnSchema)) body: WorkflowSupplierReturnInput, @Req() req: FastifyRequest) { return this.workflow.returnToSupplier(body, operationId(req), clientIp(req)); }
  @Post('employee-returns') employeeReturn(@Body(new ZodValidationPipe(workflowEmployeeReturnSchema)) body: WorkflowEmployeeReturnInput, @Req() req: FastifyRequest) { return this.workflow.returnFromRecipient(body, operationId(req), clientIp(req)); }
  @Post('purchase-cancellations') cancelPurchase(@Body(new ZodValidationPipe(workflowPurchaseCancelSchema)) body: WorkflowPurchaseCancelInput, @Req() req: FastifyRequest) { return this.workflow.cancelPurchase(body, operationId(req), clientIp(req)); }
  @Post('request-cancellations') cancelRequest(@Body(new ZodValidationPipe(workflowRequestCancelSchema)) body: WorkflowRequestCancelInput, @Req() req: FastifyRequest) { return this.workflow.cancelRequest(body, operationId(req), clientIp(req)); }
  @Post('adjustments') adjust(@Body(new ZodValidationPipe(workflowAdjustmentSchema)) body: WorkflowAdjustmentInput, @Req() req: FastifyRequest) { return this.workflow.adjust(body, operationId(req), clientIp(req)); }
  @Post('documents/:id/void') void(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowVoidSchema)) body: WorkflowVoidInput, @Req() req: FastifyRequest) { return this.workflow.voidDocument(id, body, operationId(req), clientIp(req)); }
  @Patch('requests/:id') updateRequest(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowRequestUpdateSchema)) body: WorkflowRequestUpdateInput, @Req() req: FastifyRequest) { return this.workflow.updateRequest(id, body, operationId(req), clientIp(req)); }
  @Post('requests/:id/delete') deleteRequest(@Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) { return this.workflow.deleteRequest(id, operationId(req), clientIp(req)); }
  @Patch('request-lines/:id/link') requestLineLink(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowLinkUpdateSchema)) body: WorkflowLinkUpdateInput, @Req() req: FastifyRequest) { return this.workflow.updateRequestLineLink(id, body, operationId(req), clientIp(req)); }
  @Patch('purchase-lines/:id/link') purchaseLineLink(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowLinkUpdateSchema)) body: WorkflowLinkUpdateInput, @Req() req: FastifyRequest) { return this.workflow.updatePurchaseLineLink(id, body, operationId(req), clientIp(req)); }
  @Patch('documents/:id/metadata') metadata(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(workflowMetadataSchema)) body: WorkflowMetadataInput, @Req() req: FastifyRequest) { return this.workflow.metadata(id, body, operationId(req), clientIp(req)); }
}
