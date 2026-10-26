import { expect, it } from 'vitest';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

it('物品名称迁移保留原物品、库存、流水与历史行，旧名称表从空表开始', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-catalog-migration-'));
  const schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations'), next = '20261026020000_catalog_names';
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  for (const name of readdirSync('prisma/migrations')) if (name < next) cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`, db = new PrismaClient({ datasources: { db: { url } } });
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  try {
    migrate();
    for (const sql of [
      `INSERT INTO CatalogProduct (id,name,unit) VALUES (1,'原物品名称','盒')`,
      `INSERT INTO BusinessDocument (id,kind,date) VALUES (1,'ADJUSTMENT','2026-10-01')`,
      `INSERT INTO BusinessLine (id,documentId,productId,itemName,unit,quantityUnits) VALUES (1,1,1,'原物品名称','盒',3000000)`,
      `INSERT INTO StockBalance (id,productId,originLineId,location,quantityUnits) VALUES (1,1,1,'STOCK',3000000)`,
      `INSERT INTO StockEntry (id,productId,originLineId,businessLineId,location,quantityUnits,date) VALUES (1,1,1,1,'STOCK',3000000,'2026-10-01')`,
    ]) await db.$executeRawUnsafe(sql);
    const entries = await db.stockEntry.findMany(), balances = await db.stockBalance.findMany(), lines = await db.businessLine.findMany();
    await db.$disconnect(); cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    expect(await db.catalogProduct.findUniqueOrThrow({ where: { id: 1 } })).toMatchObject({ name: '原物品名称', unit: '盒', stockVersion: 0, catalogVersion: 0 });
    expect(await db.catalogProductAlias.count()).toBe(0);
    expect(await db.stockEntry.findMany()).toEqual(entries); expect(await db.stockBalance.findMany()).toEqual(balances); expect(await db.businessLine.findMany()).toEqual(lines);
    await db.catalogProductAlias.create({ data: { productId: 1, name: '曾用名称', unit: '盒' } });
    await expect(db.catalogProductAlias.create({ data: { productId: 1, name: '曾用名称', unit: '盒' } })).rejects.toThrow();
    await expect(db.catalogProductAlias.create({ data: { productId: 999, name: '无来源', unit: '盒' } })).rejects.toThrow();
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]);
    expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
