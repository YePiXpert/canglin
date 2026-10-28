import { it, expect } from 'vitest';
import { mkdtempSync, cpSync, readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

it('Beta 1 升级保留数量账、历史付款标记、附件身份与 CHECK，新账约束生效', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-execution-migration-')), schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations');
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  const next = '20261024000000_execution_settlement';
  for (const name of readdirSync('prisma/migrations')) if (name < next) cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`, db = new PrismaClient({ datasources: { db: { url } } });
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  try {
    migrate();
    for (const sql of [
      `INSERT INTO Supplier (id,name,updatedAt) VALUES (1,'历史供应商',CURRENT_TIMESTAMP)`,
      `INSERT INTO CatalogProduct (id,name,specification,unit) VALUES (1,'迁移纸','A4','包')`,
      `INSERT INTO ProcurementRequest (id,serialNumber,department,handler,requestDate) VALUES (1,'OLD-001','行政','小林','2026-01-01')`,
      `INSERT INTO ProcurementLine (id,requestId,lineNumber,productId,itemName,unit,quantityUnits,orderedUnits) VALUES (1,1,1,1,'迁移纸','包',5000000,2000000)`,
      `INSERT INTO BusinessDocument (id,kind,date,supplierId,supplierName,totalAmountUnits,paymentStatus,invoiceIssued) VALUES (1,'PURCHASE','2026-01-02',1,'历史供应商',2000,'PAID',1)`,
      `INSERT INTO BusinessLine (id,documentId,requestLineId,productId,itemName,unit,quantityUnits,unitPriceUnits,amountUnits) VALUES (1,1,1,1,'迁移纸','包',2000000,100000,2000)`,
      `INSERT INTO Attachment (id,businessDocumentId,kind,filename,storagePath,mimeType,sizeBytes) VALUES (99,1,'INVOICE','old.pdf','old.pdf','application/pdf',8)`,
    ]) await db.$executeRawUnsafe(sql);
    const oldTables = await db.$queryRawUnsafe(`SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('StockBalance','StockEntry','BusinessLine')`);
    await db.$disconnect(); cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    expect(await db.businessDocument.findUnique({ where: { id: 1 } })).toMatchObject({ totalAmountUnits: 2000n, paymentStatus: 'PAID', invoiceIssued: true, settlementMode: 'LEGACY', settlementVersion: 0 });
    expect(await db.financialRecord.count()).toBe(0); expect(await db.attachment.findUnique({ where: { id: 99 } })).toMatchObject({ businessDocumentId: 1, filename: 'old.pdf' });
    expect(await db.$queryRawUnsafe(`SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('StockBalance','StockEntry','BusinessLine')`)).toEqual(oldTables);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]); expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
    await expect(db.$executeRawUnsafe(`UPDATE BusinessDocument SET settlementMode='GUESS' WHERE id=1`)).rejects.toThrow();
    // 付款记录用这一版的列直接插入：当前 Prisma 客户端会写入之后迁移才追加的列。
    await expect(db.$executeRawUnsafe(`INSERT INTO FinancialRecord(kind,date,payer,supplierId,amountUnits) VALUES('PAYMENT','2026-01-02','COMPANY',1,-1)`)).rejects.toThrow();
    await db.$executeRawUnsafe(`INSERT INTO FinancialRecord(id,kind,date,payer,employee,supplierId,amountUnits,openingReimbursedUnits) VALUES(1,'OPENING','2026-01-02','EMPLOYEE','小周',1,0,1000)`);
    const opening = { id: 1 };
    expect(await db.financialAllocation.create({ data: { recordId: opening.id, documentId: 1, amountUnits: 0 } })).toMatchObject({ amountUnits: 0n });
    await db.$executeRawUnsafe(`INSERT INTO FinancialRecord(id,kind,date,payer,supplierId,amountUnits) VALUES(2,'PAYMENT','2026-01-02','COMPANY',1,1000)`);
    const payment = { id: 2 };
    await expect(db.financialAllocation.create({ data: { recordId: payment.id, documentId: 1, amountUnits: 0 } })).rejects.toThrow();
    await expect(db.attachment.create({ data: { kind: 'INVOICE', filename: 'bad.pdf', storagePath: 'bad.pdf', mimeType: 'application/pdf', sizeBytes: 1 } })).rejects.toThrow();
    const draft = await db.executionDraft.create({ data: { kind: 'STOCK_IN', title: '入库', payload: '{}', basis: 'test' } }); expect(draft.kind).toBe('STOCK_IN');
    const invoice = await db.invoiceRecord.create({ data: { supplierId: 1, number: '001', date: '2026-01-02', amountUnits: 2000 } });
    await expect(db.invoiceRecord.create({ data: { supplierId: 1, number: '001', date: '2026-01-02', amountUnits: 2000 } })).rejects.toThrow();
    await db.invoiceRecord.update({ where: { id: invoice.id }, data: { status: 'VOIDED', voidReason: '纠错' } });
    expect((await db.invoiceRecord.create({ data: { supplierId: 1, number: '001', date: '2026-01-02', amountUnits: 2000 } })).id).not.toBe(invoice.id);
    const attachment = await db.attachment.create({ data: { invoiceRecordId: invoice.id, kind: 'INVOICE', filename: 'new.pdf', storagePath: 'new.pdf', mimeType: 'application/pdf', sizeBytes: 1 } }); expect(attachment.id).toBeGreaterThan(99);
    await expect(db.attachment.update({ where: { id: attachment.id }, data: { businessDocumentId: 1 } })).rejects.toThrow();
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
