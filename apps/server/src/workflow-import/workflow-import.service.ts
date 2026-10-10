import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import fs from 'node:fs';
import {
  workflowRequestCreateSchema,
  type WorkflowImportConfirmInput,
} from '@canglin/shared';
import { operation } from '../common/operation';
import { ImportsService } from '../imports/imports.service';
import { PrismaService } from '../prisma/prisma.service';
import { WorkflowService } from '../workflow/workflow.service';

/** Confirm a reviewed source and create its request atomically. */
@Injectable()
export class WorkflowImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly imports: ImportsService,
    private readonly workflow: WorkflowService,
  ) {}

  confirm(input: WorkflowImportConfirmInput, ip: string | undefined, operationId: string) {
    return this.prisma.$transaction((tx) => operation(
      tx, operationId, 'workflow:import-confirm', input, async () => {
        const { task, draft, local, source } = await this.imports.validateConfirmation(tx, input);
        if (!task || !source) throw new NotFoundException('来源任务或原件不存在');
        const parsed = workflowRequestCreateSchema.safeParse({
          serialNumber: input.serialNumber,
          department: input.department,
          handler: input.handler,
          requestDate: input.requestDate,
          sourceTaskId: task.id,
          lines: input.items.map((line) => ({
            itemName: line.itemName,
            specification: line.spec ?? '',
            unit: line.unit ?? '',
            quantity: String(line.quantity),
          })),
        });
        if (!parsed.success) throw new BadRequestException(parsed.error.issues.map((issue) => issue.message).join('；'));
        const request = await this.workflow.createRequestTx(tx, parsed.data);
        await tx.attachment.create({
          data: {
            kind: 'OA_DOC', procurementRequestId: request.id,
            filename: source.filename, storagePath: source.storagePath,
            mimeType: source.mime, sizeBytes: fs.statSync(source.full).size,
          },
        });
        const updated = await tx.importTask.updateMany({
          where: { id: task.id, version: input.version, generation: task.generation, confirmedAt: null },
          data: {
            confirmedAt: new Date(), generation: { increment: 1 },
            confirmation: JSON.stringify({ target: 'WORKFLOW', requestId: request.id, input, draft, local, ai: task.aiResult }),
          },
        });
        if (updated.count !== 1) throw new ConflictException('草稿已变化，请重新载入后确认');
        await tx.auditLog.create({
          data: {
            action: 'REQUEST_IMPORT_CONFIRM', entity: 'procurementRequest', entityId: request.id,
            detail: JSON.stringify({ taskId: task.id, serialNumber: input.serialNumber, lines: input.items.length }),
            operatorIp: ip,
          },
        });
        return { requestId: request.id, created: input.items.length, merged: 0, skipped: 0, attached: 1 };
      },
    ), { timeout: 30_000 });
  }
}
