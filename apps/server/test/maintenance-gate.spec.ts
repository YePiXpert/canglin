import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, closeApp, type TestApp } from './utils';
import { maintenance } from '../src/common/maintenance';
import { ImportsService } from '../src/imports/imports.service';

/**
 * 维护准入名额：客户端中途断开的请求也要归还，否则之后的备份 / 恢复一直等名额（最多 190 秒）、期间全站 503。
 * inject 模拟不了断开，这里真正监听端口。
 */
let ctx: TestApp, port: number;
beforeAll(async () => {
  ctx = await createApp();
  await ctx.app.listen(0, '127.0.0.1');
  port = (ctx.app.getHttpServer().address() as AddressInfo).port;
});
afterAll(() => closeApp(ctx));

const boundary = '----canglin-gate';
const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="scan.png"\r\nContent-Type: image/png\r\n\r\n`;
const tail = `\r\n--${boundary}--\r\n`;

function uploadRequest(contentLength: number): http.ClientRequest {
  const req = http.request({
    host: '127.0.0.1',
    port,
    method: 'POST',
    path: '/api/imports/upload',
    headers: {
      cookie: ctx.cookie,
      'content-type': `multipart/form-data; boundary=${boundary}`,
      'content-length': String(contentLength),
      'idempotency-key': randomUUID(),
    },
  });
  req.on('error', () => undefined); // 主动断开后的 ECONNRESET
  return req;
}

describe('维护准入名额', () => {
  it('上传到一半断开：处理结束后归还，随后可以立即备份', async () => {
    expect(maintenance.active).toBe(0);
    const req = uploadRequest(3_000_000);
    req.write(head);
    req.write(Buffer.alloc(64 * 1024, 1));
    await vi.waitFor(() => expect(maintenance.active).toBe(1));
    req.destroy();
    await vi.waitFor(() => expect(maintenance.active).toBe(0), { timeout: 3_000 });

    const backup = await ctx.inject({
      method: 'POST',
      url: '/api/system/backups',
      headers: { cookie: ctx.cookie, 'idempotency-key': randomUUID() },
    });
    expect(backup.statusCode, backup.body).toBe(201);
  });

  it('请求发完后断开：处理结束前不归还，结束后归还', async () => {
    const imports = ctx.app.get(ImportsService);
    let started!: () => void, finish!: () => void;
    const running = new Promise<void>((resolve) => (started = resolve));
    const upload = vi.spyOn(imports, 'upload').mockImplementation(async () => {
      started();
      await new Promise<void>((resolve) => (finish = resolve));
      return {} as Awaited<ReturnType<ImportsService['upload']>>;
    });
    try {
      const body = Buffer.concat([Buffer.from(head), Buffer.from('png'), Buffer.from(tail)]);
      const req = uploadRequest(body.length);
      req.end(body);
      await running;
      req.destroy();
      // 连接已经关了，但处理函数还在跑（可能正在写库），这时不能放行备份 / 恢复
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(maintenance.active).toBe(1);
      finish();
      await vi.waitFor(() => expect(maintenance.active).toBe(0), { timeout: 3_000 });
    } finally {
      upload.mockRestore();
    }
  });

  it('下载到一半断开：归还', async () => {
    // 稀疏大文件：服务端来不及在客户端断开前写完
    const full = path.join(os.tmpdir(), `canglin-gate-${randomUUID()}.pdf`);
    fs.closeSync(fs.openSync(full, 'w'));
    fs.truncateSync(full, 64 * 1024 * 1024);
    const imports = ctx.app.get(ImportsService);
    const original = vi
      .spyOn(imports, 'original')
      .mockResolvedValue({ full, mime: 'application/pdf' } as Awaited<ReturnType<ImportsService['original']>>);
    try {
      await new Promise<void>((resolve, reject) => {
        const req = http.get(
          { host: '127.0.0.1', port, path: `/api/imports/tasks/${randomUUID()}/original`, headers: { cookie: ctx.cookie } },
          (res) => {
            expect(res.statusCode).toBe(200);
            res.once('data', () => {
              req.destroy();
              resolve();
            });
          },
        );
        req.on('error', () => undefined);
        req.on('timeout', reject);
      });
      await vi.waitFor(() => expect(maintenance.active).toBe(0), { timeout: 3_000 });
    } finally {
      original.mockRestore();
      fs.rmSync(full, { force: true });
    }
  });
});
