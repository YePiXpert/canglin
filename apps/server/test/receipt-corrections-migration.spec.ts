import { expect, it } from 'vitest';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

it('到货更正迁移保留历史流水、余额和来源关系，只增加可空更正原因', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-receipt-migration-'));
  const schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations'), next = '20261026010000_receipt_corrections';
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  for (const name of readdirSync('prisma/migrations')) if (name < next) cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`, db = new PrismaClient({ datasources: { db: { url } } });
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  try {
    migrate();
    for (const sql of [
      `INSERT INTO CatalogProduct (id,name,unit) VALUES (1,'原物品','个')`,
      `INSERT INTO BusinessDocument (id,kind,date,totalAmountUnits) VALUES (1,'RECEIPT','2026-10-01',1000)`,
      `INSERT INTO BusinessLine (id,documentId,productId,itemName,unit,quantityUnits,unitPriceUnits,amountUnits) VALUES (1,1,1,'原物品','个',10000000,10000,1000)`,
      `INSERT INTO StockBalance (id,productId,originLineId,location,quantityUnits) VALUES (1,1,1,'RECEIVING',10000000)`,
      `INSERT INTO StockEntry (id,productId,originLineId,businessLineId,location,quantityUnits,date) VALUES (1,1,1,1,'RECEIVING',10000000,'2026-10-01')`,
    ]) await db.$executeRawUnsafe(sql);
    const columns = 'id,productId,originLineId,businessLineId,location,quantityUnits,date,reversalOfId,createdAt';
    const before = await db.$queryRawUnsafe(`SELECT ${columns} FROM StockEntry`);
    const balances = await db.stockBalance.findMany(), lines = await db.businessLine.findMany();
    await db.$disconnect(); cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    expect(await db.$queryRawUnsafe(`SELECT ${columns} FROM StockEntry`)).toEqual(before);
    expect(await db.stockBalance.findMany()).toEqual(balances);
    expect(await db.businessLine.findMany()).toEqual(lines);
    expect((await db.stockEntry.findUniqueOrThrow({ where: { id: 1 } })).correctionReason).toBeNull();
    await db.stockEntry.create({ data: { productId: 1, originLineId: 1, businessLineId: 1, location: 'RECEIVING', quantityUnits: -2000000n, date: '2026-10-02', correctionReason: '实到8件' } });
    await expect(db.$executeRawUnsafe(`UPDATE StockBalance SET quantityUnits=-1 WHERE id=1`)).rejects.toThrow();
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
