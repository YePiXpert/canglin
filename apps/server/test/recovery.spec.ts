import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import { createApp, closeApp, type TestApp } from './utils';
import { BackupService } from '../src/system/backup.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { config } from '../src/config';
import { recoverRestore, writeRestoreJournal } from '../src/system/restore-files';
let ctx: TestApp, backup: BackupService, prisma: PrismaService;
beforeAll(async () => {
  ctx = await createApp();
  backup = ctx.app.get(BackupService);
  prisma = ctx.app.get(PrismaService);
});
afterAll(() => closeApp(ctx));
let sampleId = 0;
const sample = async () =>
  (await prisma.catalogProduct.findUniqueOrThrow({ where: { id: sampleId } })).specification;
it('restores a coherent snapshot and invalidates old sessions', async () => {
  sampleId = (
    await prisma.catalogProduct.create({ data: { name: '恢复样本', specification: '5', unit: '件' } })
  ).id;
  fs.writeFileSync(path.join(config.uploadsDir, 'evidence.txt'), 'original');
  const saved = await backup.create();
  await prisma.catalogProduct.update({ where: { id: sampleId }, data: { specification: '9' } });
  fs.writeFileSync(path.join(config.uploadsDir, 'evidence.txt'), 'changed');
  await backup.restore(saved.name);
  expect(await sample()).toBe('5');
  expect(fs.readFileSync(path.join(config.uploadsDir, 'evidence.txt'), 'utf8')).toBe('original');
  expect(
    (await ctx.inject({ method: 'GET', url: '/api/workflow/requests', headers: { cookie: ctx.cookie } }))
      .statusCode,
  ).toBe(401);
});
it('rejects corrupt manifest before changing live data', async () => {
  const saved = await backup.create(),
    zip = new AdmZip(backup.path(saved.name));
  zip.updateFile('uploads/evidence.txt', Buffer.from('tampered'));
  zip.writeZip(backup.path(saved.name));
  await expect(backup.restore(saved.name)).rejects.toThrow('校验');
  expect(fs.readFileSync(path.join(config.uploadsDir, 'evidence.txt'), 'utf8')).toBe('original');
});
it('rolls back an interrupted file replacement', async () => {
  const saved = await backup.create();
  await prisma.catalogProduct.update({ where: { id: sampleId }, data: { specification: '12' } });
  const real = fs.renameSync;
  let failed = false;
  const mock = vi.spyOn(fs, 'renameSync').mockImplementation((from, to) => {
    if (!failed && String(from).includes('/new/uploads')) {
      failed = true;
      throw new Error('simulated disk failure');
    }
    return real(from, to);
  });
  await expect(backup.restore(saved.name)).rejects.toThrow('simulated');
  mock.mockRestore();
  expect(await sample()).toBe('12');
  expect(fs.readFileSync(path.join(config.uploadsDir, 'evidence.txt'), 'utf8')).toBe('original');
});
it('startup recovery restores files from a crash journal', () => {
  const root = fs.mkdtempSync('/tmp/procure-recovery-'),
    dir = '.restore-test';
  fs.mkdirSync(path.join(root, dir, 'old', 'uploads'), { recursive: true });
  fs.writeFileSync(path.join(root, dir, 'old', 'procure.db'), 'old');
  fs.writeFileSync(path.join(root, 'procure.db'), 'partial');
  writeRestoreJournal(root, dir, 'SWAPPING');
  recoverRestore(root);
  expect(fs.readFileSync(path.join(root, 'procure.db'), 'utf8')).toBe('old');
  expect(fs.existsSync(path.join(root, 'restore-journal.json'))).toBe(false);
  fs.rmSync(root, { recursive: true });
});
/**
 * Writes a manifest-less backup the way an older release would: a database migrated with only the
 * migrations older than `before`, seeded with raw SQL (the current Prisma client no longer matches it).
 */
async function olderBackup(name: string, before: string, seed: string[]) {
  const root = fs.mkdtempSync('/tmp/procure-legacy-');
  try {
    fs.mkdirSync(path.join(root, 'migrations'));
    const source = path.resolve(__dirname, '../prisma');
    fs.copyFileSync(path.join(source, 'schema.prisma'), path.join(root, 'schema.prisma'));
    for (const migration of fs.readdirSync(path.join(source, 'migrations')))
      if (migration.startsWith('2026') && migration < before)
        fs.cpSync(path.join(source, 'migrations', migration), path.join(root, 'migrations', migration), {
          recursive: true,
        });
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--schema',
        path.join(root, 'schema.prisma'),
      ],
      { env: { ...process.env, DATABASE_URL: `file:${root}/procure.db` }, stdio: 'pipe' },
    );
    const legacy = new PrismaClient({ datasources: { db: { url: `file:${root}/procure.db` } } });
    try {
      for (const sql of seed) await legacy.$executeRawUnsafe(sql);
    } finally {
      await legacy.$disconnect();
    }
    const zip = new AdmZip();
    zip.addLocalFile(path.join(root, 'procure.db'));
    zip.writeZip(path.join(config.backupsDir, name));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
/** The id the next new attachment receives (the probe row is removed again). */
async function nextAttachmentId() {
  const probe = await prisma.attachment.create({
    data: {
      kind: 'INVOICE',
      filename: 'probe.pdf',
      storagePath: 'attachments/probe.pdf',
      mimeType: 'application/pdf',
      sizeBytes: 1,
    },
  });
  await prisma.attachment.delete({ where: { id: probe.id } });
  return probe.id;
}
it('migrates a legacy backup in an isolated copy before replacing the live database', async () => {
  // A backup taken before the trusted-import release: only the migrations older than it.
  // Legacy V2 ledger rows; the attachment files are deliberately absent from the backup, so the
  // restore only passes if the drop-legacy migration removes the item-only attachment rows.
  await olderBackup('backup-legacy.zip', '20260927', [
    `INSERT INTO "Supplier"(id,name,updatedAt) VALUES (900,'旧供应商',CURRENT_TIMESTAMP)`,
    `INSERT INTO "Item"(id,serialNumber,department,handler,requestDate,itemName,quantity,supplierId,updatedAt) VALUES (900,'OLD-1','行政','张三','2026-01-01','旧台账纸',1,900,CURRENT_TIMESTAMP)`,
    `INSERT INTO "SupplierPriceRecord"(supplierId,itemName,unitPrice) VALUES (900,'旧台账纸',2)`,
    `INSERT INTO "Attachment"(kind,itemId,filename,storagePath,mimeType,sizeBytes) VALUES ('INVOICE',900,'old.pdf','attachments/legacy-missing.pdf','application/pdf',1)`,
    // The highest attachment id belongs to a legacy row as well.
    `INSERT INTO "Attachment"(id,kind,itemId,filename,storagePath,mimeType,sizeBytes) VALUES (900,'OA_DOC',900,'old-oa.pdf','imports/legacy-missing.pdf','application/pdf',1)`,
  ]);
  await backup.restore('backup-legacy.zip');
  expect(await prisma.importRevision.count()).toBe(0);
  const migrations = await prisma.$queryRawUnsafe<{ migration_name: string }[]>(
    'SELECT migration_name FROM _prisma_migrations',
  );
  expect(migrations.some((m) => m.migration_name === '20260927000000_trusted_import')).toBe(true);
  expect(migrations.some((m) => m.migration_name === '20261008000000_drop_legacy_hardening')).toBe(true);
  expect(await prisma.supplier.findUnique({ where: { name: '旧供应商' } })).not.toBeNull();
  expect(await prisma.attachment.count()).toBe(0);
  const tables = await prisma.$queryRawUnsafe<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('Item','SupplierPriceRecord','Distribution','Product')",
  );
  expect(tables).toEqual([]);
  // Removing the legacy attachments does not free their ids for new uploads.
  expect(await nextAttachmentId()).toBe(901);
});
it('unconfirms import tasks confirmed through the legacy ledger and keeps deleted attachment ids', async () => {
  // A backup from the release before the drop-legacy migration, when both confirm paths existed
  // (ImportTask.confirmedAt only exists from the trusted-import migration on).
  await olderBackup('backup-pre-drop-legacy.zip', '20261008', [
    // Confirmed through the removed legacy ledger: the snapshot names no workflow request.
    `INSERT INTO "ImportTask"(id,filename,status,aiStatus,generation,version,confirmedAt,confirmation) VALUES ('legacy-confirmed','old.pdf','DONE','DISABLED',1,2,CURRENT_TIMESTAMP,'{"input":{"serialNumber":"OLD-2"},"ids":[900]}')`,
    // Confirmed through the workflow import, together with the request it created.
    `INSERT INTO "ImportTask"(id,filename,status,aiStatus,generation,version,confirmedAt,confirmation) VALUES ('workflow-confirmed','new.pdf','DONE','DISABLED',1,2,CURRENT_TIMESTAMP,'{"target":"WORKFLOW","requestId":900}')`,
    `INSERT INTO "ProcurementRequest"(id,serialNumber,department,handler,requestDate,sourceTaskId) VALUES (900,'NEW-1','行政','李四','2026-09-30','workflow-confirmed')`,
    // An attachment deleted before the backup: the Attachment rebuild must not hand its id out again.
    `INSERT INTO "Attachment"(id,kind,filename,storagePath,mimeType,sizeBytes) VALUES (950,'INVOICE','gone.pdf','attachments/gone.pdf','application/pdf',1)`,
    `DELETE FROM "Attachment" WHERE id = 950`,
  ]);
  await backup.restore('backup-pre-drop-legacy.zip');
  expect(await prisma.importTask.findMany({ orderBy: { id: 'asc' } })).toEqual([
    expect.objectContaining({
      id: 'legacy-confirmed',
      confirmedAt: null,
      confirmation: null,
      generation: 1,
      version: 2,
    }),
    expect.objectContaining({
      id: 'workflow-confirmed',
      confirmedAt: expect.any(Date),
      confirmation: '{"target":"WORKFLOW","requestId":900}',
      generation: 1,
      version: 2,
    }),
  ]);
  expect(await nextAttachmentId()).toBe(951);
});
