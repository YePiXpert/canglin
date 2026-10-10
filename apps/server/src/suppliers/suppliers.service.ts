import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import type { SupplierUpsertInput } from '@procure-lite/shared';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list() {
    return this.prisma.supplier.findMany({
      include: {
        _count: { select: { businessDocuments: true } },
      },
      orderBy: { name: 'asc' },
    });
  }

  async upsert(input: SupplierUpsertInput, ip?: string) {
    const data = { name: input.name, contact: input.contact, phone: input.phone, note: input.note };
    if (input.id) {
      const supplier = await this.prisma.supplier
        .update({ where: { id: input.id }, data })
        .catch((e) => this.mapUnique(e));
      await this.audit.log('SUPPLIER_UPDATE', { entity: 'supplier', entityId: supplier.id, ip });
      return supplier;
    }
    const supplier = await this.prisma.supplier
      .create({ data })
      .catch((e) => this.mapUnique(e));
    await this.audit.log('SUPPLIER_CREATE', { entity: 'supplier', entityId: supplier.id, ip });
    return supplier;
  }

  async remove(id: number, ip?: string) {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { businessDocuments: true } } },
    });
    if (!supplier) throw new NotFoundException('供应商不存在');
    if (supplier._count.businessDocuments > 0) {
      throw new ConflictException('该供应商已关联采购记录，不能删除');
    }
    await this.prisma.supplier.delete({ where: { id } });
    await this.audit.log('SUPPLIER_DELETE', { entity: 'supplier', entityId: id, ip });
    return { ok: true };
  }

  private mapUnique(e: unknown): never {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      throw new ConflictException('已存在同名供应商');
    }
    throw e;
  }
}
