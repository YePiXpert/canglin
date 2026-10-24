import { PlanningController } from './planning.controller';
import { StocktakeService } from './stocktake.service';
import { ReplenishmentService } from './replenishment.service';
import { FollowupService } from './followup.service';
import { Module } from '@nestjs/common';
import { WorkflowController } from './workflow.controller';
import { WorkflowService } from './workflow.service';
import { WorkflowQueryService } from './workflow-query.service';
import { StockReconcileService } from './stock-reconcile.service';
import { PaymentsQueryService } from './payments-query.service';

@Module({
  controllers: [WorkflowController, PlanningController],
  providers: [StocktakeService, ReplenishmentService, FollowupService, WorkflowService, WorkflowQueryService, StockReconcileService, PaymentsQueryService],
  exports: [WorkflowService, WorkflowQueryService, StockReconcileService, FollowupService, ReplenishmentService],
})
export class WorkflowModule {}
