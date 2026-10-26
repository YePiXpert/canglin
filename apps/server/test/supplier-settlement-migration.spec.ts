import { expect, it } from 'vitest';
import { copyFileSync, cpSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

it('结算周期迁移只追加空字段，保留原付款、分配及采购', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-supplier-migration-')), next = '20261026030000_supplier_settlement_period';
  const schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations');
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  for (const name of readdirSync('prisma/migrations')) if (name < next) cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`, db = new PrismaClient({ datasources: { db: { url } } });
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  try {
    migrate();
    for (const sql of ["INSERT INTO Supplier(id,name,updatedAt) VALUES(1,'历史供应商',CURRENT_TIMESTAMP)", "INSERT INTO BusinessDocument(id,kind,date,supplierId,supplierName,totalAmountUnits) VALUES(1,'PURCHASE','2026-10-01',1,'历史供应商',10000)", "INSERT INTO FinancialRecord(id,kind,date,supplierId,payer,amountUnits) VALUES(1,'PAYMENT','2026-10-15',1,'COMPANY',10000)", 'INSERT INTO FinancialAllocation(id,recordId,documentId,amountUnits) VALUES(1,1,1,10000)']) await db.$executeRawUnsafe(sql);
    const before = await db.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM FinancialRecord');
    const allocations = await db.financialAllocation.findMany(), documents = await db.businessDocument.findMany();
    await db.$disconnect(); cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    const row = await db.financialRecord.findUniqueOrThrow({ where: { id: 1 } });
    expect(row).toMatchObject({ amountUnits: 10000n, settlementFrom: null, settlementTo: null, status: 'POSTED' });
    const after = await db.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM FinancialRecord');
    for (const [key, value] of Object.entries(before[0]!)) expect(after[0]![key]).toEqual(value);
    expect(await db.financialAllocation.findMany()).toEqual(allocations); expect(await db.businessDocument.findMany()).toEqual(documents);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]); expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);
