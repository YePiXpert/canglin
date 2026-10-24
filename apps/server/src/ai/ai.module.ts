import { ExecutionModule } from '../execution/execution.module';
import { Module } from '@nestjs/common';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { WorkflowModule } from '../workflow/workflow.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';
import { AiToolsService } from './ai-tools';

@Module({
  imports: [SuppliersModule, WorkflowModule, ExecutionModule],
  controllers: [AiController],
  providers: [AiService, AiToolsService],
})
export class AiModule {}
