import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { AuthGuard } from './auth/auth.guard';
import { ImportsModule } from './imports/imports.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { SystemModule } from './system/system.module';
import { AttachmentsModule } from './attachments/attachments.module';
import { AiCoreModule } from './ai/ai-core.module';
import { AiModule } from './ai/ai.module';
import { HealthController } from './health.controller';
import { WorkflowModule } from './workflow/workflow.module';
import { WorkflowImportModule } from './workflow-import/workflow-import.module';
import { ExecutionModule } from './execution/execution.module';

@Module({
  imports: [
    ScheduleModule.forRoot(),
    PrismaModule,
    AuditModule,
    AiCoreModule,
    AuthModule,
    ImportsModule,
    SuppliersModule,
    SystemModule,
    AttachmentsModule,
    WorkflowModule,
    ExecutionModule,
    WorkflowImportModule,
    AiModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: AuthGuard }],
})
export class AppModule {}
