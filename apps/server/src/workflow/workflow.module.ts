import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowQueryService } from './workflow-query.service';
import { StockReconcileService } from './stock-reconcile.service';

@Module({
  controllers: [WorkflowController],
  providers: [WorkflowService, WorkflowQueryService, StockReconcileService],
  exports: [WorkflowService, WorkflowQueryService, StockReconcileService],
})
export class WorkflowModule {}
