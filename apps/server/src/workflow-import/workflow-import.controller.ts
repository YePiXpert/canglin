import { Body, Controller, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { workflowImportConfirmSchema, type WorkflowImportConfirmInput } from '@canglin/shared';
import { clientIp, operationId } from '../common/request.util';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { WorkflowImportService } from './workflow-import.service';

@Controller('workflow/imports')
export class WorkflowImportController {
  constructor(private readonly service: WorkflowImportService) {}

  @Post('confirm')
  confirm(@Body(new ZodValidationPipe(workflowImportConfirmSchema)) body: WorkflowImportConfirmInput, @Req() req: FastifyRequest) {
    return this.service.confirm(body, clientIp(req), operationId(req));
  }
}
