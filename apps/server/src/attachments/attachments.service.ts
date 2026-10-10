import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
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
    if ([params.procurementRequestId, params.businessDocumentId].filter((id) => id !== undefined).length !== 1) {
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
      if ((params.kind === 'INVOICE' && document.kind !== 'PURCHASE') || (params.kind === 'SIGNOFF' && document.kind !== 'DISTRIBUTION')) {
        throw new BadRequestException('发票须关联采购单，签收凭证须关联发放单');
      }
    }

    const storedName = `${randomUUID()}${ext}`;
    const storagePath = path.join(config.uploadsDir, 'attachments', storedName);
    fs.mkdirSync(path.dirname(storagePath), { recursive: true });
    fs.writeFileSync(storagePath, params.file.buffer);

    const record = await this.prisma.attachment.create({
      data: {
        kind: params.kind,
        procurementRequestId: params.procurementRequestId ?? null,
        businessDocumentId: params.businessDocumentId ?? null,
        filename,
        storagePath: `attachments/${storedName}`,
        mimeType: params.file.mimetype || 'application/octet-stream',
        sizeBytes: params.file.size,
      },
    }).catch((error) => {
      fs.rmSync(storagePath, { force: true });
      throw error;
    });
    await this.audit.log('ATTACHMENT_UPLOAD', {
      entity: 'attachment',
      entityId: record.id,
      detail: { kind: params.kind, filename },
      ip: params.ip,
    });
    return record;
  }

  async list(params: { procurementRequestId?: number; businessDocumentId?: number }) {
    return this.prisma.attachment.findMany({
      where: {
        ...(params.procurementRequestId ? { procurementRequestId: params.procurementRequestId } : {}),
        ...(params.businessDocumentId ? { businessDocumentId: params.businessDocumentId } : {}),
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
    await this.prisma.attachment.delete({ where: { id } });
    await this.releaseFile(record.storagePath);
    await this.audit.log('ATTACHMENT_DELETE', {
      entity: 'attachment',
      entityId: id,
      ip,
    });
    return { ok: true };
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
