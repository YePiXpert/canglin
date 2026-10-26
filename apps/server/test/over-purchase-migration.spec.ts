import { expect, it } from 'vitest';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

it('多购迁移保留原申请数量上限与旧单金额，新增备货字段不改写历史行', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-over-purchase-'));
  const schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations'), next = '20261026000000_allow_over_purchase';
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  for (const name of readdirSync('prisma/migrations')) if (name < next) cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`, db = new PrismaClient({ datasources: { db: { url } } });
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  try {
    migrate();
    for (const sql of [
      `INSERT INTO Supplier (id,name,updatedAt) VALUES (1,'原供应商',CURRENT_TIMESTAMP)`,
      `INSERT INTO CatalogProduct (id,name,unit) VALUES (1,'U盘','个')`,
      `INSERT INTO ProcurementRequest (id,serialNumber,department,handler,requestDate) VALUES (1,'OLD-1','行政','小周','2026-10-01')`,
      `INSERT INTO ProcurementLine (id,requestId,lineNumber,productId,itemName,unit,quantityUnits,orderedUnits) VALUES (1,1,1,1,'U盘','个',5000000,5000000)`,
      `INSERT INTO BusinessDocument (id,kind,date,supplierId,supplierName,totalAmountUnits) VALUES (1,'PURCHASE','2026-10-02',1,'原供应商',25000)`,
      `INSERT INTO BusinessLine (id,documentId,requestLineId,productId,itemName,unit,quantityUnits,unitPriceUnits,amountUnits) VALUES (1,1,1,1,'U盘','个',5000000,500000,25000)`,
    ]) await db.$executeRawUnsafe(sql);
    const before = await db.$queryRawUnsafe(`SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('ProcurementLine','StockBalance','StockEntry')`);
    await db.$disconnect(); cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    expect(await db.businessLine.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ quantityUnits: 5000000n, overPurchaseUnits: 0n, amountUnits: 25000n });
    expect(await db.procurementLine.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ quantityUnits: 5000000n, orderedUnits: 5000000n });
    expect(await db.$queryRawUnsafe(`SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('ProcurementLine','StockBalance','StockEntry')`)).toEqual(before);
    await expect(db.$executeRawUnsafe(`UPDATE ProcurementLine SET orderedUnits=6000000 WHERE id=1`)).rejects.toThrow();
    await db.businessLine.update({ where: { id: 1 }, data: { quantityUnits: 10000000n, overPurchaseUnits: 5000000n, amountUnits: 50000n } });
    await expect(db.businessLine.update({ where: { id: 1 }, data: { overPurchaseUnits: -1n } })).rejects.toThrow();
    await expect(db.businessLine.update({ where: { id: 1 }, data: { overPurchaseUnits: 10000001n } })).rejects.toThrow();
    await expect(db.businessLine.update({ where: { id: 1 }, data: { receivedUnits: 11000000n } })).rejects.toThrow();
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
