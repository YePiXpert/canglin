import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { SuppliersService } from './suppliers.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp } from '../common/request.util';
import { supplierUpsertSchema, type SupplierUpsertInput } from '@canglin/shared';

@Controller('suppliers')
export class SuppliersController {
  constructor(private readonly suppliers: SuppliersService) {}

  @Get()
  list() {
    return this.suppliers.list();
  }

  @Post()
  upsert(
    @Body(new ZodValidationPipe(supplierUpsertSchema)) body: SupplierUpsertInput,
    @Req() req: FastifyRequest,
  ) {
    return this.suppliers.upsert(body, clientIp(req));
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: FastifyRequest) {
    return this.suppliers.remove(id, clientIp(req));
  }
}
