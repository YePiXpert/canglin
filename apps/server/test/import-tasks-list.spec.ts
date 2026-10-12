import { beforeAll, afterAll, describe, it, expect, vi } from 'vitest';
import { createApp, closeApp, type TestApp } from './utils';
import { PrismaService } from '../src/prisma/prisma.service';
import { ImportsService } from '../src/imports/imports.service';
import { OcrClient } from '../src/imports/ocr.client';
import { LlmClient } from '../src/ai/llm.client';
import { config } from '../src/config';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

// The database may already hold tasks from other suites: assert membership and relative counts only.
let ctx: TestApp, prisma: PrismaService, imports: ImportsService;
const local = {
  schemaVersion: 2 as const,
  parserVersion: '3',
  mode: 'IMAGE_OCR' as const,
  pageCount: 1,
  pages: [{ page: 1, status: 'DONE' as const, mode: 'IMAGE_OCR' }],
  warnings: [],
  serialNumber: 'OA-LIST',
  department: '行政部',
  handler: '张三',
  requestDate: '2026-09-27',
  items: [
    {
      lineId: 'p1-r1',
      itemName: '列表测试用笔',
      quantity: null,
      unit: '支',
      source: { page: 1, method: 'IMAGE_OCR' },
    },
  ],
};
const ocr = {
  inspect: vi.fn(async () => ({ pageCount: 1 })),
  parse: vi.fn(async () => local),
  page: vi.fn(async () => ({ bytes: Buffer.from('image'), mime: 'image/png' })),
};
const llm = {
  chat: vi.fn(async () => ({ content: '{}', toolCalls: [] })),
  ping: vi.fn(async () => true),
};
const SUMMARY_KEYS = [
  'aiStatus',
  'confirmed',
  'confirmedAt',
  'createdAt',
  'filename',
  'finishedAt',
  'id',
  'originalAvailable',
  'status',
];
type Summary = { id: string } & Record<string, unknown>;
type ListBody = { tasks: Summary[]; total: number; page: number; pageSize: number };

beforeAll(async () => {
  ctx = await createApp({
    override: (b) =>
      b.overrideProvider(OcrClient).useValue(ocr).overrideProvider(LlmClient).useValue(llm),
  });
  prisma = ctx.app.get(PrismaService);
  imports = ctx.app.get(ImportsService);
});
afterAll(() => closeApp(ctx));

function get(url: string) {
  return ctx.inject({ method: 'GET', url, headers: { cookie: ctx.cookie } });
}
function post(url: string, payload: unknown) {
  return ctx.inject({
    method: 'POST',
    url,
    headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() },
    payload: payload as object,
  });
}
async function list(query = ''): Promise<ListBody> {
  const res = await get(`/api/imports/tasks${query}`);
  expect(res.statusCode).toBe(200);
  return res.json();
}
/** Walk every page so the assertions do not depend on how many tasks already exist. */
async function allIds(confirmed: boolean) {
  const ids: string[] = [];
  for (let page = 1; ; page++) {
    const body = await list(`?confirmed=${confirmed}&page=${page}&pageSize=50`);
    ids.push(...body.tasks.map((t) => t.id));
    if (!body.tasks.length || ids.length >= body.total) return { ids, total: body.total };
  }
}
async function seedTask(filename = `list-${randomUUID()}.png`) {
  const id = randomUUID(),
    storagePath = `imports/${id}.png`;
  fs.mkdirSync(path.join(config.uploadsDir, 'imports'), { recursive: true });
  fs.writeFileSync(path.join(config.uploadsDir, storagePath), `original-${id}`);
  await prisma.importTask.create({
    data: { id, filename, storagePath, status: 'DONE', result: JSON.stringify(local) },
  });
  return id;
}
async function settle(id: string) {
  for (let i = 0; i < 100; i++) {
    const t = await imports.task(id);
    if (![t.status, t.aiStatus].some((s) => s === 'PENDING' || s === 'RUNNING')) return t;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('task did not settle');
}
/** Save a complete draft through the service; returns the confirm payload for its version. */
async function completeDraft(id: string) {
  const t = await imports.task(id);
  const draft = {
    ...t.draft!,
    serialNumber: `OA-LIST-${randomUUID().slice(0, 8)}`,
    items: [{ ...t.draft!.items[0], quantity: 2 }],
  };
  await imports.saveDraft(id, t.version, draft);
  return { draft, body: { ...draft, taskId: id, version: t.version + 1 } };
}

describe('import task list', () => {
  it('requires a session', async () => {
    expect((await ctx.inject({ method: 'GET', url: '/api/imports/tasks' })).statusCode).toBe(401);
  });

  it('filters on confirmedAt: a locally DONE task stays unconfirmed until it is confirmed', async () => {
    const id = await seedTask();
    expect((await allIds(false)).ids).toContain(id);
    expect((await allIds(true)).ids).not.toContain(id);
    const { body } = await completeDraft(id);
    expect((await post('/api/workflow/imports/confirm', body)).statusCode).toBe(201);
    expect((await allIds(false)).ids).not.toContain(id);
    expect((await allIds(true)).ids).toContain(id);
    const row = (await list('?confirmed=true&pageSize=50')).tasks.find((t) => t.id === id);
    expect(row).toMatchObject({ confirmed: true, status: 'DONE' });
    expect(typeof row?.confirmedAt).toBe('string');
  });

  it('returns only summary fields, never paths, results or drafts', async () => {
    const filename = `summary-${randomUUID()}.png`;
    const id = await seedTask(filename);
    await completeDraft(id);
    const res = await get('/api/imports/tasks');
    expect(res.statusCode).toBe(200);
    const body: ListBody = res.json();
    expect(Object.keys(body).sort()).toEqual(['page', 'pageSize', 'tasks', 'total']);
    expect(body).toMatchObject({ page: 1, pageSize: 10 });
    for (const t of body.tasks) expect(Object.keys(t).sort()).toEqual(SUMMARY_KEYS);
    // Newest first, so the task seeded last is on the first page.
    expect(body.tasks.find((t) => t.id === id)).toMatchObject({
      filename,
      status: 'DONE',
      aiStatus: 'DISABLED',
      confirmed: false,
      confirmedAt: null,
      finishedAt: null,
      originalAvailable: true,
    });
    for (const secret of [`imports/${id}`, 'p1-r1', '列表测试用笔', 'OA-LIST'])
      expect(res.body).not.toContain(secret);
    fs.rmSync(path.join(config.uploadsDir, `imports/${id}.png`));
    expect((await list()).tasks.find((t) => t.id === id)?.originalAvailable).toBe(false);
  });

  it('restores workflow-confirmed task links from the confirmation summary without exposing its JSON', async () => {
    const id = await seedTask();
    const { body } = await completeDraft(id);
    const confirmed = await post('/api/workflow/imports/confirm', body);
    expect(confirmed.statusCode, confirmed.body).toBe(201);
    const requestId = confirmed.json().requestId;
    const row = (await list('?confirmed=true&pageSize=50')).tasks.find((task) => task.id === id);
    expect(row).toMatchObject({ confirmed: true, requestId });
    expect(Object.keys(row!).sort()).toEqual([...SUMMARY_KEYS, 'requestId'].sort());
    expect(row).not.toHaveProperty('confirmation');
    expect((await imports.task(id)).requestId).toBe(requestId);
  });

  it('paginates newest first and validates the query', async () => {
    const a = await seedTask(),
      b = await seedTask();
    const first = await list('?pageSize=1'),
      second = await list('?pageSize=1&page=2');
    expect(first.tasks).toHaveLength(1);
    expect(first.total).toBeGreaterThanOrEqual(2);
    expect(first.pageSize).toBe(1);
    expect(second.tasks).toHaveLength(1);
    expect(second.page).toBe(2);
    expect(second.tasks[0].id).not.toBe(first.tasks[0].id);
    expect([first.tasks[0].id, second.tasks[0].id].sort()).toEqual([a, b].sort());
    for (const query of ['pageSize=0', 'pageSize=51', 'page=abc', 'page=0', 'confirmed=yes'])
      expect((await get(`/api/imports/tasks?${query}`)).statusCode, query).toBe(400);
  });

  it('reading the list, a task and its revisions never runs recognition or changes the task', async () => {
    const id = await seedTask();
    await completeDraft(id);
    const calls = () => ({
      parse: ocr.parse.mock.calls.length,
      inspect: ocr.inspect.mock.calls.length,
      page: ocr.page.mock.calls.length,
      chat: llm.chat.mock.calls.length,
    });
    const state = async () => {
      const row = await prisma.importTask.findUniqueOrThrow({ where: { id } });
      return {
        status: row.status,
        aiStatus: row.aiStatus,
        generation: row.generation,
        version: row.version,
        draft: row.draft,
        revisions: await prisma.importRevision.count({ where: { taskId: id } }),
      };
    };
    const beforeCalls = calls(),
      beforeState = await state();
    for (const url of [
      '/api/imports/tasks',
      '/api/imports/tasks?confirmed=true',
      `/api/imports/tasks/${id}`,
      `/api/imports/tasks/${id}/revisions`,
    ])
      expect((await get(url)).statusCode, url).toBe(200);
    // Anything wrongly enqueued would start on the next tick.
    await new Promise((r) => setTimeout(r, 100));
    expect(calls()).toEqual(beforeCalls);
    expect(await state()).toEqual(beforeState);
  });

  it('answers 404 for a missing task without creating a replacement', async () => {
    const pending = (await list()).total,
      confirmed = (await list('?confirmed=true')).total,
      rows = await prisma.importTask.count();
    const res = await get(`/api/imports/tasks/${randomUUID()}`);
    expect(res.statusCode).toBe(404);
    expect((await list()).total).toBe(pending);
    expect((await list('?confirmed=true')).total).toBe(confirmed);
    expect(await prisma.importTask.count()).toBe(rows);
  });

  it('keeps a confirmed task read-only: no second confirmation, no draft writes', async () => {
    const id = await seedTask();
    const { draft, body } = await completeDraft(id);
    expect((await post('/api/workflow/imports/confirm', body)).statusCode).toBe(201);
    expect((await post('/api/workflow/imports/confirm', body)).statusCode).toBe(409);
    const put = await ctx.inject({
      method: 'PUT',
      url: `/api/imports/tasks/${id}/draft`,
      headers: { cookie: ctx.cookie },
      payload: { version: body.version, draft: { ...draft, department: '改过的部门' } },
    });
    expect(put.statusCode).toBe(409);
    expect((await imports.task(id)).draft?.department).toBe(draft.department);
  });

  it('points a repeated upload at the newest unconfirmed task, else the latest confirmed one', async () => {
    const buffer = Buffer.from(`duplicate-${randomUUID()}`);
    const file = { buffer, filename: 'duplicate.png', size: buffer.length };
    const x = (await imports.upload(file)).taskId!;
    await settle(x);
    expect((await post('/api/workflow/imports/confirm', (await completeDraft(x)).body)).statusCode).toBe(201);
    const y = (await imports.upload(file, undefined, true)).taskId!;
    expect(y).not.toBe(x);
    await settle(y);
    const rows = await prisma.importTask.count();
    // X is confirmed and older; the unconfirmed Y is the one to continue.
    expect(await imports.upload(file)).toEqual({ duplicateTaskId: y });
    expect(await prisma.importTask.count()).toBe(rows);
    // Once both are confirmed, the most recently confirmed task (Y) wins, not the first one.
    expect((await post('/api/workflow/imports/confirm', (await completeDraft(y)).body)).statusCode).toBe(201);
    expect(await imports.upload(file)).toEqual({ duplicateTaskId: y });
    expect(await prisma.importTask.count()).toBe(rows);
    // An older unconfirmed task (Z) beats a newer confirmed one (W); plain createdAt desc would pick W.
    const z = (await imports.upload(file, undefined, true)).taskId!;
    await settle(z);
    const w = (await imports.upload(file, undefined, true)).taskId!;
    await settle(w);
    expect((await post('/api/workflow/imports/confirm', (await completeDraft(w)).body)).statusCode).toBe(201);
    expect(await prisma.importTask.count()).toBe(rows + 2);
    expect(await imports.upload(file)).toEqual({ duplicateTaskId: z });
    expect(await prisma.importTask.count()).toBe(rows + 2);
    // All confirmed, in the order X, Y, W, Z: the most recently confirmed Z wins, although W is newer.
    expect((await post('/api/workflow/imports/confirm', (await completeDraft(z)).body)).statusCode).toBe(201);
    expect(await imports.upload(file)).toEqual({ duplicateTaskId: z });
    expect(await prisma.importTask.count()).toBe(rows + 2);
  });
});
