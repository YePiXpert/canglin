import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';

const ALLOWED_EXTS = ['.pdf', '.png', '.jpg', '.jpeg'];

export interface StoredAttachment {
  record: {
    id: number;
    kind: string;
    filename: string;
    mimeType: string;
    sizeBytes: number;
    createdAt: Date;
  };
  filePath: string;
}

/** 附件存储：发票 / 签收凭证等，落盘到 state/uploads */
@Injectable()
export class AttachmentsService implements OnModuleDestroy {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async save(params: {
    file: { buffer: Buffer; filename: string; size: number; mimetype: string };
    kind: string;
    procurementRequestId?: number;
    businessDocumentId?: number;
    financialRecordId?: number;
    invoiceRecordId?: number;
    ip?: string;
  }) {
    const filename = path.basename(params.file.filename || 'attachment');
    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXTS.includes(ext)) {
      throw new BadRequestException('附件仅支持 PDF / PNG / JPG 格式');
    }
    if (params.file.size > config.maxUploadBytes) {
      throw new BadRequestException('附件超过大小限制');
    }
    if ([params.procurementRequestId, params.businessDocumentId, params.financialRecordId, params.invoiceRecordId].filter((id) => id !== undefined).length !== 1) {
      throw new BadRequestException('附件必须关联一个业务对象');
    }
    if (params.procurementRequestId) {
      const request = await this.prisma.procurementRequest.findUnique({ where: { id: params.procurementRequestId } });
      if (!request) throw new NotFoundException('申请单不存在');
      if (params.kind !== 'OA_DOC') throw new BadRequestException('申请附件请使用原单类型');
    }
    if (params.businessDocumentId) {
      const document = await this.prisma.businessDocument.findUnique({ where: { id: params.businessDocumentId } });
      if (!document) throw new NotFoundException('业务单据不存在');
      if ((params.kind === 'INVOICE' && document.kind !== 'PURCHASE') || (params.kind === 'SIGNOFF' && document.kind !== 'DISTRIBUTION') || (params.kind === 'DELIVERY' && document.kind !== 'RECEIPT')) {
        throw new BadRequestException('发票须关联采购单，签收凭证须关联发放单');
      }
    }

    const contentHash = createHash('sha256').update(params.file.buffer).digest('hex');
    if (params.financialRecordId && !await this.prisma.financialRecord.findUnique({ where: { id: params.financialRecordId } })) throw new NotFoundException('资金记录不存在');
    if (params.invoiceRecordId) {
      const invoice = await this.prisma.invoiceRecord.findUnique({ where: { id: params.invoiceRecordId } });
      if (!invoice || invoice.status !== 'DRAFT') throw new ConflictException('只允许给待核对发票添加原件');
      const same = await this.prisma.attachment.findFirst({ where: { contentHash, invoiceRecordId: { not: null }, invoiceRecord: { status: { not: 'VOIDED' } } } });
      if (same) { if (same.invoiceRecordId === params.invoiceRecordId) return same; throw new ConflictException('该文件已关联其他发票，请核对重复票据'); }
    }
    const storedName = `${randomUUID()}${ext}`;
    const storagePath = path.join(config.uploadsDir, 'attachments', storedName);
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, params.file.buffer);

    const record = await this.prisma.$transaction(async tx => {
      if (params.invoiceRecordId) {
        const invoice = await tx.invoiceRecord.findUnique({ where: { id: params.invoiceRecordId } });
        if (!invoice || invoice.status !== 'DRAFT') throw new ConflictException('发票已变化，请重新核对');
        if (await tx.attachment.findFirst({ where: { contentHash, invoiceRecordId: { not: null }, invoiceRecord: { status: { not: 'VOIDED' } } } })) throw new ConflictException('该发票文件刚被上传，请刷新后核对');
      }
      const record = await tx.attachment.create({ data: {
        kind: params.kind, procurementRequestId: params.procurementRequestId ?? null, businessDocumentId: params.businessDocumentId ?? null,
        financialRecordId: params.financialRecordId ?? null, invoiceRecordId: params.invoiceRecordId ?? null, contentHash,
        filename, storagePath: `attachments/${storedName}`, mimeType: params.file.mimetype || 'application/octet-stream', sizeBytes: params.file.size,
      } });
      if (params.invoiceRecordId) await tx.invoiceRecord.update({ where: { id: params.invoiceRecordId }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({ data: { action: 'ATTACHMENT_UPLOAD', entity: 'attachment', entityId: record.id, detail: JSON.stringify({ kind: params.kind, filename }), operatorIp: params.ip } });
      return record;
    }).catch(error => { fs.rmSync(storagePath, { force: true }); throw error; });
    return record;
  }

  async list(params: { procurementRequestId?: number; businessDocumentId?: number; financialRecordId?: number; invoiceRecordId?: number }) {
    return this.prisma.attachment.findMany({
      where: {
        ...(params.procurementRequestId ? { procurementRequestId: params.procurementRequestId } : {}),
        ...(params.businessDocumentId ? { businessDocumentId: params.businessDocumentId } : {}),
        ...(params.financialRecordId ? { financialRecordId: params.financialRecordId } : {}),
        ...(params.invoiceRecordId ? { invoiceRecordId: params.invoiceRecordId } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async get(id: number): Promise<StoredAttachment> {
    const record = await this.prisma.attachment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('附件不存在');
    const filePath = path.join(config.uploadsDir, record.storagePath);
    if (!fs.existsSync(filePath)) throw new NotFoundException('附件文件缺失');
    return { record, filePath };
  }

  async remove(id: number, ip?: string) {
    const record = await this.prisma.attachment.findUnique({ where: { id } });
    if (!record) throw new NotFoundException('附件不存在');
    if (record.kind === 'OA_DOC' && record.procurementRequestId) {
      throw new BadRequestException('已入账申请的原件须保留，不能删除');
    }
    await this.prisma.$transaction(async tx => {
      if (record.financialRecordId) throw new BadRequestException('资金凭证须保留，请追加说明或新的凭证');
      if (record.invoiceRecordId) {
        const invoice = await tx.invoiceRecord.findUniqueOrThrow({ where: { id: record.invoiceRecordId } });
        if (invoice.status !== 'DRAFT') throw new BadRequestException('已确认或已作废发票的原件须保留');
        await tx.invoiceRecord.update({ where: { id: invoice.id }, data: { version: { increment: 1 } } });
      }
      await tx.attachment.delete({ where: { id } });
      await tx.auditLog.create({ data: { action: 'ATTACHMENT_DELETE', entity: 'attachment', entityId: id, operatorIp: ip } });
    });
    await this.releaseFile(record.storagePath);
    return { ok: true };
  }

  async linkInvoice(invoiceId: number, attachmentId: number, ip?: string) {
    const { record: original, filePath } = await this.get(attachmentId);
    const contentHash = createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
    return this.prisma.$transaction(async tx => {
      const invoice = await tx.invoiceRecord.findUnique({ where: { id: invoiceId } });
      const attachment = await tx.attachment.findUnique({ where: { id: original.id }, include: { businessDocument: true } });
      if (!invoice || invoice.status !== 'DRAFT') throw new ConflictException('发票不存在或已确认');
      if (!attachment || attachment.kind !== 'INVOICE' || attachment.businessDocument?.supplierId !== invoice.supplierId) throw new BadRequestException('原件须来自同一供应商的采购发票附件');
      const same = await tx.attachment.findFirst({ where: { contentHash, invoiceRecordId: { not: null }, invoiceRecord: { status: { not: 'VOIDED' } } } });
      if (same) { if (same.invoiceRecordId === invoiceId) return same; throw new ConflictException('该原件已关联其他发票'); }
      const row = await tx.attachment.create({ data: { invoiceRecordId: invoiceId, kind: 'INVOICE', filename: attachment.filename, storagePath: attachment.storagePath, mimeType: attachment.mimeType, sizeBytes: attachment.sizeBytes, contentHash } });
      await tx.invoiceRecord.update({ where: { id: invoiceId }, data: { version: { increment: 1 } } });
      await tx.auditLog.create({ data: { action: 'INVOICE_ATTACH_ORIGINAL', entity: 'invoice', entityId: invoiceId, detail: JSON.stringify({ attachmentId }), operatorIp: ip } });
      return row;
    });
  }

  /**
   * 按引用计数回收物理文件：OA 原件由导入任务与它创建的申请（原件附件）共用同一个文件，
   * 附件记录和导入任务都不再引用时才能真正删盘。
   */
  async releaseFile(storagePath: string): Promise<void> {
    const remaining = await this.prisma.attachment.count({ where: { storagePath } });
    if (remaining > 0 || (await this.prisma.importTask.count({ where: { storagePath } }))) return;
    fs.rmSync(path.join(config.uploadsDir, storagePath), { force: true });
  }

  onModuleDestroy(): void {
    // 预留：清理孤儿文件
  }
}
