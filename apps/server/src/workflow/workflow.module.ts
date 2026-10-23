import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowQueryService } from './workflow-query.service';
import { StockReconcileService } from './stock-reconcile.service';
import { PaymentsQueryService } from './payments-query.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowQueryService, StockReconcileService, PaymentsQueryService],
  exports: [WorkflowService, WorkflowQueryService, StockReconcileService],
})
export class WorkflowModule {}
