import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Req,
  Res,
  Body,
} from '@nestjs/common';
import fs from 'node:fs';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { BackupService } from './backup.service';
import { AutoBackupService } from './auto-backup.service';
import { OcrClient } from '../imports/ocr.client';
import { PrismaService } from '../prisma/prisma.service';
import { StockReconcileService } from '../workflow/stock-reconcile.service';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp } from '../common/request.util';
import { config } from '../config';
import { autoBackupConfigSchema, type AutoBackupConfig } from '@procure-lite/shared';

const APP_VERSION = '2.0.0';

@Controller('system')
export class SystemController {
  constructor(
    private readonly backup: BackupService,
    private readonly autoBackup: AutoBackupService,
    private readonly ocr: OcrClient,
    private readonly prisma: PrismaService,
    private readonly stock: StockReconcileService,
  ) {}

  @Get('status')
  async status() {
    const [requests, products, documents, stockCheck] = await Promise.all([
      this.prisma.procurementRequest.count(),
      this.prisma.catalogProduct.count(),
      this.prisma.businessDocument.count({ where: { status: 'POSTED' } }),
      this.stock.latest(),
    ]);
    let dbSizeBytes = 0;
    try {
      dbSizeBytes = fs.statSync(config.dbPath).size;
    } catch {
      // 数据库文件尚未创建时按 0 计
    }
    return {
      version: APP_VERSION,
      uptimeSeconds: Math.floor(process.uptime()),
      dbSizeBytes,
      counts: { requests, products, documents },
      autoBackup: await this.autoBackup.getConfig(),
      restoring: this.backup.isRestoring(),
      stockCheck,
    };
  }

  /** 立即执行一次库存对账（每天 3 点也会自动执行，按服务器时区 TZ 计）；不一致时写审计日志，不自动修正 */
  @Post('stock-check')
  @HttpCode(200)
  stockCheck() {
    return this.stock.reconcile();
  }

  @Get('ocr-health')
  ocrHealth() {
    return this.ocr.health();
  }

  /* --------------------------------- 备份 ---------------------------------- */

  @Get('backups')
  backups() {
    return this.backup.list();
  }

  @Post('backups')
  createBackup(@Req() req: FastifyRequest) {
    return this.backup.create(clientIp(req));
  }

  @Get('backups/:name/download')
  download(@Param('name') name: string, @Res({ passthrough: true }) res: FastifyReply) {
    const full = this.backup.path(name);
    res.header('content-type', 'application/zip');
    res.header('content-disposition', `attachment; filename="${name}"`);
    return fs.readFileSync(full);
  }

  @Post('backups/:name/restore')
  @HttpCode(200)
  restore(@Param('name') name: string, @Req() req: FastifyRequest) {
    return this.backup.restore(name, clientIp(req));
  }

  @Delete('backups/:name')
  removeBackup(@Param('name') name: string, @Req() req: FastifyRequest) {
    return this.backup.remove(name, clientIp(req));
  }

  /* -------------------------------- 自动备份 ------------------------------- */

  @Get('auto-backup')
  getAutoBackup() {
    return this.autoBackup.getConfig();
  }

  @Put('auto-backup')
  updateAutoBackup(
    @Body(new ZodValidationPipe(autoBackupConfigSchema)) body: AutoBackupConfig,
  ) {
    return this.autoBackup.updateConfig(body);
  }
}
