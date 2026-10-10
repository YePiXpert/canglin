import { Module } from '@nestjs/common';
import { SystemController } from './system.controller';
import { BackupService } from './backup.service';
import { AutoBackupService } from './auto-backup.service';
import { HousekeepingService } from './housekeeping.service';
import { ImportsModule } from '../imports/imports.module';
import { WorkflowModule } from '../workflow/workflow.module';

@Module({
  imports: [ImportsModule, WorkflowModule],
  controllers: [SystemController],
  providers: [BackupService, AutoBackupService, HousekeepingService],
})
export class SystemModule {}
