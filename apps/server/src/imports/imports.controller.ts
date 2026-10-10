import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Put,
  Res,
  ParseIntPipe,
  Query,
} from '@nestjs/common';
import fs from 'node:fs';
import type { FastifyReply } from 'fastify';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ImportsService } from './imports.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp } from '../common/request.util';
import { readUpload } from '../common/multipart.util';
import {
  saveImportDraftSchema,
  type ImportDraft,
} from '@procure-lite/shared';

@Controller('imports')
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Post('upload')
  async upload(@Req() req: FastifyRequest, @Query('continueDuplicate') continueDuplicate?: string) {
    const file = await readUpload(req);
    return this.imports.upload(file, clientIp(req), continueDuplicate === 'true');
  }

  /** 找回未确认 / 已入账的导入任务（只读，不触发识别） */
  @Get('tasks')
  list(
    @Query(
      new ZodValidationPipe(
        z.object({
          confirmed: z.enum(['true', 'false']).default('false'),
          page: z.coerce.number().int().min(1).default(1),
          pageSize: z.coerce.number().int().min(1).max(50).default(10),
        }),
      ),
    )
    query: { confirmed: 'true' | 'false'; page: number; pageSize: number },
  ) {
    return this.imports.list(query.confirmed === 'true', query.page, query.pageSize);
  }

  @Get('tasks/:id')
  task(@Param('id') id: string) {
    return this.imports.task(id);
  }

  @Get('tasks/:id/original')
  async original(@Param('id') id: string, @Res() reply: FastifyReply) {
    const source = await this.imports.original(id);
    reply.header('Cache-Control', 'private, no-store').type(source.mime);
    return reply.send(fs.createReadStream(source.full));
  }

  @Get('tasks/:id/revisions')
  revisions(@Param('id') id: string) {
    return this.imports.revisions(id);
  }

  @Get('tasks/:id/pages/:page')
  async page(
    @Param('id') id: string,
    @Param('page', ParseIntPipe) page: number,
    @Res() reply: FastifyReply,
  ) {
    const image = await this.imports.page(id, page);
    return reply
      .header('Cache-Control', 'private, no-store')
      .type(image.mime)
      .send(image.bytes);
  }

  @Put('tasks/:id/draft')
  saveDraft(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(saveImportDraftSchema))
    body: { version: number; draft: ImportDraft },
  ) {
    return this.imports.saveDraft(id, body.version, body.draft);
  }

  @Post('tasks/:id/retry')
  retry(
    @Param('id') id: string,
    @Body(
      new ZodValidationPipe(
        z.object({
          stage: z.enum(['local', 'ai']),
          pages: z.array(z.number().int().min(1).max(30)).optional(),
        }),
      ),
    )
    body: { stage: 'local' | 'ai'; pages?: number[] },
  ) {
    return this.imports.retry(id, body.stage, body.pages);
  }

  @Post('tasks/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.imports.cancel(id);
  }
}
