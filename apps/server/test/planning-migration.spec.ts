import { it, expect } from 'vitest';
import { mkdtempSync, cpSync, readdirSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

it('从上一版增量迁移保留旧申请、物品、外键与 CHECK，并加入新约束', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-planning-migration-'));
  const schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations');
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  const next = '20261023000000_inventory_planning';
  for (const name of readdirSync('prisma/migrations')) if (name < next || name === 'migration_lock.toml') cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`;
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  const db = new PrismaClient({ datasources: { db: { url } } });
  try {
    migrate();
    await db.$executeRawUnsafe(`INSERT INTO CatalogProduct (id,name,specification,unit) VALUES (1,'迁移纸','A4','包')`);
    await db.$executeRawUnsafe(`INSERT INTO ProcurementRequest (id,serialNumber,department,handler,requestDate) VALUES (1,'OLD-001','行政','小林','2026-01-01')`);
    await db.$executeRawUnsafe(`INSERT INTO ProcurementLine (id,requestId,lineNumber,productId,itemName,unit,quantityUnits) VALUES (1,1,1,1,'迁移纸','包',5000000)`);
    const tables = await db.$queryRawUnsafe<{ name: string; sql: string }[]>(`SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('StockBalance','StockEntry','BusinessLine')`);
    await db.$disconnect();
    cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    expect(await db.procurementRequest.findUnique({ where: { id: 1 } })).toMatchObject({ serialNumber: 'OLD-001', purpose: 'GENERAL' });
    expect(await db.catalogProduct.findUnique({ where: { id: 1 }, select: { name: true, stockVersion: true } })).toMatchObject({ name: '迁移纸', stockVersion: 0 });
    expect((await db.procurementLine.findUniqueOrThrow({ where: { id: 1 } })).quantityUnits).toBe(5000000n);
    expect(await db.$queryRawUnsafe(`PRAGMA foreign_key_check`)).toEqual([]);
    expect(await db.$queryRawUnsafe(`PRAGMA integrity_check`)).toEqual([{ integrity_check: 'ok' }]);
    expect(await db.$queryRawUnsafe(`SELECT name,sql FROM sqlite_master WHERE type='table' AND name IN ('StockBalance','StockEntry','BusinessLine')`)).toEqual(tables);
    await expect(db.$executeRawUnsafe(`INSERT INTO PurchaseFollowup (kind) VALUES ('ARRIVAL')`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE CatalogProduct SET stockVersion=-1 WHERE id=1`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`UPDATE ProcurementRequest SET purpose='GUESS' WHERE id=1`)).rejects.toThrow();
    await expect(db.$executeRawUnsafe(`INSERT INTO StockPolicy (productId,minimumUnits,targetUnits) VALUES (1,10,5)`)).rejects.toThrow();
    const count = await db.stocktake.create({ data: { title: '验证约束' } });
    await expect(db.stocktakeLine.create({ data: { stocktakeId: count.id, productId: 1, itemName: '纸', specification: '', unit: '包', baselineUnits: 0, stockVersion: 0, actualUnits: -1 } })).rejects.toThrow();
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30_000);
