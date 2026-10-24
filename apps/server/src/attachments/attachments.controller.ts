import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import fs from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AttachmentsService } from './attachments.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp } from '../common/request.util';
import { readUpload } from '../common/multipart.util';

const kindQuery = z.object({
  kind: z.enum(['INVOICE', 'SIGNOFF', 'DELIVERY']).default('INVOICE'),
});

@Controller('attachments')
export class AttachmentsController {
  constructor(private readonly attachments: AttachmentsService) {}

  @Post('requests/:id')
  async uploadForRequest(@Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) {
    return this.attachments.save({ file: await readUpload(req), kind: 'OA_DOC', procurementRequestId: id, ip: clientIp(req) });
  }

  @Post('documents/:id')
  async uploadForDocument(
    @Param('id', ParseIntPipe) id: number,
    @Query(new ZodValidationPipe(kindQuery)) query: { kind: 'INVOICE' | 'SIGNOFF' | 'DELIVERY' },
    @Req() req: FastifyRequest,
  ) {
    return this.attachments.save({ file: await readUpload(req), kind: query.kind, businessDocumentId: id, ip: clientIp(req) });
  }

  @Post('financial-records/:id')
  uploadForFinancial(@Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) {
    return readUpload(req).then(file => this.attachments.save({ file, kind: 'PAYMENT', financialRecordId: id, ip: clientIp(req) }));
  }

  @Post('invoices/:id')
  uploadForInvoice(@Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) {
    return readUpload(req).then(file => this.attachments.save({ file, kind: 'INVOICE', invoiceRecordId: id, ip: clientIp(req) }));
  }

  @Post('invoices/:id/link')
  linkInvoice(@Param('id', ParseIntPipe) id: number, @Body(new ZodValidationPipe(z.object({ attachmentId: z.number().int().positive() }).strict())) body: { attachmentId: number }, @Req() req: FastifyRequest) {
    return this.attachments.linkInvoice(id, body.attachmentId, clientIp(req));
  }

  @Get()
  list(
    @Query(
      new ZodValidationPipe(
        z.object({
          procurementRequestId: z.coerce.number().int().positive().optional(),
          businessDocumentId: z.coerce.number().int().positive().optional(),
          financialRecordId: z.coerce.number().int().positive().optional(),
          invoiceRecordId: z.coerce.number().int().positive().optional(),
        }),
      ),
    )
    query: { procurementRequestId?: number; businessDocumentId?: number; financialRecordId?: number; invoiceRecordId?: number },
  ) {
    return this.attachments.list(query);
  }

  @Get(':id/download')
  async download(@Param('id', ParseIntPipe) id: number, @Res() res: FastifyReply) {
    const { record, filePath } = await this.attachments.get(id);
    const size = fs.statSync(filePath).size;
    res.status(200);
    res.header('content-type', record.mimeType);
    res.header(
      'content-disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(record.filename)}`,
    );
    res.header('content-length', String(size));
    fs.createReadStream(filePath).pipe(res.raw);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) {
    return this.attachments.remove(id, clientIp(req));
  }
}
