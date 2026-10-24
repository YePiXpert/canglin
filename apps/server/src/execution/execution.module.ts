import { InvoiceRecognitionService } from './invoice-recognition.service';
import { ImportsModule } from '../imports/imports.module';
import { ExceptionsService } from './exceptions.service';
import { DraftsService } from './drafts.service';
import { Module } from '@nestjs/common';
import { WorkflowModule } from '../workflow/workflow.module';
import { ExecutionController } from './execution.controller';
import { BatchesService } from './batches.service';
import { FinanceService } from './finance.service';
import { InvoicesService } from './invoices.service';
@Module({ imports: [WorkflowModule, ImportsModule], controllers: [ExecutionController], providers: [InvoiceRecognitionService, BatchesService, FinanceService, InvoicesService, ExceptionsService, DraftsService], exports: [BatchesService, FinanceService, InvoicesService, ExceptionsService, DraftsService] })
export class ExecutionModule {}
