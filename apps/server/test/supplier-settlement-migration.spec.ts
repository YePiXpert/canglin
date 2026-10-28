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
    const row = await db.financialRecord.findUniqueOrThrow({ where: { id: 1 }, select: { amountUnits: true, settlementFrom: true, settlementTo: true, status: true } });
    expect(row).toMatchObject({ amountUnits: 10000n, settlementFrom: null, settlementTo: null, status: 'POSTED' });
    const after = await db.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM FinancialRecord');
    for (const [key, value] of Object.entries(before[0]!)) expect(after[0]![key]).toEqual(value);
    expect(await db.financialAllocation.findMany()).toEqual(allocations); expect(await db.businessDocument.findMany()).toEqual(documents);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]); expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);

it('结算记录迁移按操作回执标出已有统一结算，单笔付款及其余字段不变', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'canglin-settlement-records-')), next = '20261028000000_supplier_settlement_records';
  const schema = path.join(dir, 'schema.prisma'), migrations = path.join(dir, 'migrations');
  mkdirSync(migrations); copyFileSync('prisma/schema.prisma', schema);
  for (const name of readdirSync('prisma/migrations')) if (name < next) cpSync(path.join('prisma/migrations', name), path.join(migrations, name), { recursive: true });
  const url = `file:${dir}/migration.db`, db = new PrismaClient({ datasources: { db: { url } } });
  const migrate = () => execFileSync(process.execPath, [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schema], { env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe' });
  try {
    migrate();
    for (const sql of [
      "INSERT INTO Supplier(id,name,updatedAt) VALUES(1,'账期供应商',CURRENT_TIMESTAMP)",
      "INSERT INTO BusinessDocument(id,kind,date,supplierId,supplierName,totalAmountUnits) VALUES(1,'PURCHASE','2026-10-01',1,'账期供应商',10000),(2,'PURCHASE','2026-10-02',1,'账期供应商',20000)",
      "INSERT INTO FinancialRecord(id,kind,date,supplierId,payer,amountUnits) VALUES(1,'PAYMENT','2026-10-15',1,'COMPANY',10000),(2,'PAYMENT','2026-10-27',1,'COMPANY',20000)",
      'INSERT INTO FinancialAllocation(id,recordId,documentId,amountUnits) VALUES(1,1,1,10000),(2,2,2,20000)',
      `INSERT INTO OperationReceipt(id,scope,requestHash,response) VALUES('single','workflow:financial_create','h1','{"id":1,"kind":"PAYMENT"}'),('settled','workflow:supplier_settlement','h2','{"settlementFrom":null,"settlementTo":null,"id":2,"kind":"PAYMENT"}')`,
    ]) await db.$executeRawUnsafe(sql);
    const before = await db.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM FinancialRecord ORDER BY id');
    await db.$disconnect(); cpSync(path.join('prisma/migrations', next), path.join(migrations, next), { recursive: true }); migrate();
    expect((await db.financialRecord.findMany({ orderBy: { id: 'asc' }, select: { supplierSettlement: true } })).map(row => row.supplierSettlement)).toEqual([false, true]);
    const after = await db.$queryRawUnsafe<Record<string, unknown>[]>('SELECT * FROM FinancialRecord ORDER BY id');
    for (const [index, row] of before.entries()) for (const [key, value] of Object.entries(row)) expect(after[index]![key]).toEqual(value);
    expect(await db.$queryRawUnsafe('PRAGMA foreign_key_check')).toEqual([]); expect(await db.$queryRawUnsafe('PRAGMA integrity_check')).toEqual([{ integrity_check: 'ok' }]);
  } finally { await db.$disconnect(); rmSync(dir, { recursive: true, force: true }); }
}, 30000);
