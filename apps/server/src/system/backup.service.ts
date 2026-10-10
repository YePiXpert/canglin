import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';
import archiver from 'archiver';
import AdmZip from 'adm-zip';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';
import { maintenance, restoreEvents } from '../common/maintenance';
import { recoverRestore, writeRestoreJournal } from './restore-files';

export interface BackupInfo {
  name: string;
  sizeBytes: number;
  createdAt: string;
}
const sha = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const schemaPath = path.resolve(__dirname, '../../prisma/schema.prisma');
/** 2026-10-10 改名前的备份里数据库条目名 */
export const LEGACY_DB_ENTRY = 'procure.db';
function files(directory: string, prefix = ''): string[] {
  if (!fs.existsSync(directory)) return [];
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((e) =>
      e.isSymbolicLink()
        ? []
        : e.isDirectory()
          ? files(path.join(directory, e.name), prefix + e.name + '/')
          : [prefix + e.name],
    );
}
@Injectable()
export class BackupService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}
  isRestoring() {
    return maintenance.locked;
  }
  async create(ip?: string): Promise<BackupInfo> {
    return maintenance.exclusive(async () => {
      const name = `backup-${Date.now()}-${randomUUID()}.zip`,
        target = path.join(config.backupsDir, name),
        snapshot = path.join(config.backupsDir, `.snapshot-${randomUUID()}.db`);
      try {
        await this.prisma.$executeRawUnsafe(`VACUUM INTO '${snapshot.replace(/'/g, "''")}'`);
        const hashes: Record<string, string> = { 'canglin.db': sha(fs.readFileSync(snapshot)) };
        for (const file of files(config.uploadsDir))
          hashes[`uploads/${file}`] = sha(fs.readFileSync(path.join(config.uploadsDir, file)));
        const manifest = {
          formatVersion: 2,
          schemaHash: sha(fs.readFileSync(schemaPath)),
          createdAt: new Date().toISOString(),
          files: hashes,
        };
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(target),
            archive = archiver('zip', { zlib: { level: 6 } });
          output.on('close', resolve);
          output.on('error', reject);
          archive.on('error', reject);
          archive.pipe(output);
          archive.file(snapshot, { name: 'canglin.db' });
          archive.directory(config.uploadsDir, 'uploads');
          archive.append(JSON.stringify(manifest), { name: 'manifest.json' });
          void archive.finalize();
        });
        await this.audit.log('BACKUP_CREATE', { detail: { name }, ip });
        return { name, sizeBytes: fs.statSync(target).size, createdAt: manifest.createdAt };
      } catch (error) {
        fs.rmSync(target, { force: true });
        throw error;
      } finally {
        fs.rmSync(snapshot, { force: true });
      }
    });
  }
  list(): BackupInfo[] {
    return fs
      .readdirSync(config.backupsDir)
      .filter((n) => n.endsWith('.zip'))
      .map((name) => {
        const s = fs.statSync(path.join(config.backupsDir, name));
        return { name, sizeBytes: s.size, createdAt: s.mtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  path(name: string) {
    if (!/^backup-[\w-]+\.zip$/.test(name)) throw new BadRequestException('备份文件名不合法');
    const full = path.join(config.backupsDir, name);
    if (!fs.existsSync(full)) throw new NotFoundException('备份不存在');
    return full;
  }
  private async validate(db: string, root: string, migrate: boolean) {
    let client = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
    try {
      const integrity =
        await client.$queryRawUnsafe<Record<string, unknown>[]>('PRAGMA integrity_check');
      if (integrity.length !== 1 || Object.values(integrity[0])[0] !== 'ok')
        throw new BadRequestException('备份数据库损坏');
      if ((await client.$queryRawUnsafe<unknown[]>('PRAGMA foreign_key_check')).length)
        throw new BadRequestException('备份外键不完整');
    } finally {
      await client.$disconnect();
    }
    if (migrate)
      execFileSync(
        process.execPath,
        [require.resolve('prisma/build/index.js'), 'migrate', 'deploy', '--schema', schemaPath],
        { env: { ...process.env, DATABASE_URL: `file:${db}` }, stdio: 'pipe', timeout: 60_000 },
      );
    client = new PrismaClient({ datasources: { db: { url: `file:${db}` } } });
    try {
      const attachments = await client.attachment.findMany({ select: { storagePath: true } });
      const tasks = await client.importTask.findMany({
        where: { storagePath: { not: null } },
        select: { storagePath: true },
      });
      for (const entry of [...attachments, ...tasks]) {
        if (!entry.storagePath) continue;
        const absolute = path.resolve(root, 'uploads', entry.storagePath);
        if (
          !absolute.startsWith(path.resolve(root, 'uploads') + path.sep) ||
          !fs.existsSync(absolute)
        )
          throw new BadRequestException(`备份缺少原件或附件：${entry.storagePath}`);
      }
      await client.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
    } finally {
      await client.$disconnect();
    }
  }
  async restore(name: string, ip?: string): Promise<void> {
    const full = this.path(name);
    return maintenance.exclusive(async () => {
      const directory = `.restore-${randomUUID()}`,
        root = path.join(config.dataDir, directory),
        stage = path.join(root, 'new'),
        old = path.join(root, 'old');
      let switched = false;
      let disconnected = false;
      fs.mkdirSync(stage, { recursive: true });
      fs.mkdirSync(old);
      try {
        const zip = new AdmZip(full),
          entries = zip.getEntries();
        if (
          entries.length > 20_000 ||
          entries.reduce((n, e) => n + e.header.size, 0) > 2 * 1024 ** 3
        )
          throw new BadRequestException('备份内容超限');
        const names = new Set<string>();
        for (const e of entries) {
          const n = e.entryName === LEGACY_DB_ENTRY ? 'canglin.db' : e.entryName;
          if (
            n.includes('..') ||
            n.includes('\\') ||
            path.isAbsolute(n) ||
            names.has(n) ||
            !/^(canglin\.db|manifest\.json|uploads\/.+|uploads\/)$/.test(n) ||
            ((e.header.attr >>> 16) & 0xf000) === 0xa000
          )
            throw new BadRequestException('备份包含非法路径或重复条目');
          names.add(n);
        }
        zip.extractAllTo(stage, true);
        const manifestPath = path.join(stage, 'manifest.json');
        let sameSchema = false;
        if (fs.existsSync(manifestPath)) {
          const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
          if (manifest.formatVersion !== 2) throw new BadRequestException('不支持的备份版本');
          for (const [file, hash] of Object.entries(manifest.files as Record<string, string>)) {
            const absolute = path.resolve(stage, file);
            if (
              !absolute.startsWith(stage + path.sep) ||
              !fs.existsSync(absolute) ||
              sha(fs.readFileSync(absolute)) !== hash
            )
              throw new BadRequestException('备份文件校验失败');
          }
          for (const e of entries)
            if (!e.isDirectory && e.entryName !== 'manifest.json' && !manifest.files[e.entryName])
              throw new BadRequestException('备份文件未列入清单');
          sameSchema = manifest.schemaHash === sha(fs.readFileSync(schemaPath));
        }
        const db = path.join(stage, 'canglin.db'),
          legacyDb = path.join(stage, LEGACY_DB_ENTRY);
        if (fs.existsSync(legacyDb)) fs.renameSync(legacyDb, db);
        if (!fs.existsSync(db)) throw new BadRequestException('备份缺少数据库');
        await this.validate(db, stage, !sameSchema);
        fs.mkdirSync(path.join(stage, 'uploads'), { recursive: true });
        const epoch = await this.prisma.systemSecurity.findUnique({
          where: { id: 1 },
          select: { sessionEpoch: true },
        });
        await this.prisma.$queryRawUnsafe('PRAGMA wal_checkpoint(TRUNCATE)');
        await this.prisma.$disconnect();
        disconnected = true;
        writeRestoreJournal(config.dataDir, directory, 'SWAPPING');
        switched = true;
        for (const suffix of ['-wal', '-shm']) fs.rmSync(config.dbPath + suffix, { force: true });
        for (const file of ['canglin.db', 'uploads']) {
          const live = path.join(config.dataDir, file);
          if (fs.existsSync(live)) fs.renameSync(live, path.join(old, file));
          fs.renameSync(path.join(stage, file), live);
        }
        await this.prisma.$connect();
        disconnected = false;
        await this.prisma.applyPragmas();
        const restored = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
        if (restored)
          await this.prisma.systemSecurity.update({
            where: { id: 1 },
            data: { sessionEpoch: Math.max(restored.sessionEpoch, epoch?.sessionEpoch ?? 0) + 1 },
          });
        await this.audit.log('BACKUP_RESTORE', { detail: { name }, ip });
        writeRestoreJournal(config.dataDir, directory, 'COMMITTED');
        recoverRestore(config.dataDir);
        switched = false;
        maintenance.epoch++;
        await Promise.all(restoreEvents.listeners('restored').map((listener) => listener()));
      } catch (error) {
        if (switched) {
          await this.prisma.$disconnect();
          recoverRestore(config.dataDir);
          await this.prisma.$connect();
          await this.prisma.applyPragmas();
        } else if (disconnected) {
          await this.prisma.$connect();
          await this.prisma.applyPragmas();
        }
        throw error;
      } finally {
        if (!switched) fs.rmSync(root, { recursive: true, force: true });
      }
    });
  }
  remove(name: string, ip?: string) {
    if (maintenance.locked) throw new BadRequestException('维护中不能删除备份');
    fs.rmSync(this.path(name));
    void this.audit.log('BACKUP_DELETE', { detail: { name }, ip });
    return { ok: true };
  }
  prune(keep: number) {
    let n = 0;
    for (const b of this.list().slice(keep)) {
      fs.rmSync(this.path(b.name));
      n++;
    }
    return n;
  }
}
