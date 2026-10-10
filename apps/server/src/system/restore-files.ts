import fs from 'node:fs';
import path from 'node:path';
/** Recovery is synchronous and runs before Prisma opens the live database. */
export function recoverRestore(dataDir: string) {
  const journal = path.join(dataDir, 'restore-journal.json');
  if (!fs.existsSync(journal)) return;
  const state = JSON.parse(fs.readFileSync(journal, 'utf8')) as {
    phase: string;
    directory: string;
  };
  if (!/^\.restore-[a-z0-9-]+$/.test(state.directory)) throw new Error('恢复日志路径非法');
  const old = path.join(dataDir, state.directory, 'old');
  if (state.phase !== 'COMMITTED') {
    for (const file of ['canglin.db', 'uploads']) {
      const saved = path.join(old, file),
        live = path.join(dataDir, file);
      if (fs.existsSync(saved)) {
        fs.rmSync(live, { recursive: true, force: true });
        fs.renameSync(saved, live);
      }
    }
    for (const suffix of ['-wal', '-shm'])
      fs.rmSync(path.join(dataDir, 'canglin.db' + suffix), { force: true });
  }
  fs.rmSync(path.join(dataDir, state.directory), { recursive: true, force: true });
  fs.rmSync(journal, { force: true });
}
export function writeRestoreJournal(dataDir: string, directory: string, phase: string) {
  const target = path.join(dataDir, 'restore-journal.json');
  fs.writeFileSync(target + '.tmp', JSON.stringify({ directory, phase }));
  const fd = fs.openSync(target + '.tmp', 'r');
  fs.fsyncSync(fd);
  fs.closeSync(fd);
  fs.renameSync(target + '.tmp', target);
  const directoryFd = fs.openSync(dataDir, 'r');
  fs.fsyncSync(directoryFd);
  fs.closeSync(directoryFd);
}
