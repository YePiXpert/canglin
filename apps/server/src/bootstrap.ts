import type { ServerResponse } from 'node:http';
import { maintenance } from './common/maintenance';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyPluginCallback } from 'fastify';
import type { FastifyCookieOptions } from '@fastify/cookie';
import type { FastifyHelmetOptions } from '@fastify/helmet';
import type { FastifyMultipartOptions } from '@fastify/multipart';
import fastifyCookie from '@fastify/cookie';
import fastifyHelmet from '@fastify/helmet';
import fastifyMultipart from '@fastify/multipart';
import { PrismaExceptionFilter } from './common/prisma-exception.filter';
import { config } from './config';

/** main 与测试共用的应用装配（入参校验统一走 zod 管道，不用 class-validator） */
export async function configureApp(app: NestFastifyApplication): Promise<void> {
  app.setGlobalPrefix('api');
  await app.register(fastifyHelmet as FastifyPluginCallback<FastifyHelmetOptions>, {
    contentSecurityPolicy: false,
  });
  await app.register(fastifyCookie as FastifyPluginCallback<FastifyCookieOptions>);
  await app.register(fastifyMultipart as FastifyPluginCallback<FastifyMultipartOptions>, {
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });
  const fastify = app.getHttpAdapter().getInstance();
  /**
   * 每个非独占请求占一个准入名额，处理完才归还，备份 / 恢复要等名额归零。
   * 正常在 onResponse（响应写完）归还；客户端中途断开（上传到一半关页面）时 finish 不会触发、
   * onResponse 不执行，改为「处理已给出响应（onSend）」与「连接已关闭」都发生后归还。
   * 不在断开的那一刻归还：处理函数可能还在写库或落盘，这时放行恢复会互相覆盖。
   */
  const gates = new WeakMap<object, { release: () => void; sent: boolean; closed: boolean }>();
  fastify.addHook(
    'onRequest',
    async (
      req: { method: string; url: string },
      reply: { code: (n: number) => { send: (body: unknown) => void }; raw: ServerResponse },
    ) => {
      if (maintenance.locked) {
        reply.code(503).send({ message: '备份或恢复维护中，请稍后重试' });
        return;
      }
      const exclusive =
        req.method === 'POST' &&
        /^\/api\/system\/backups(?:\/[^/]+\/restore)?(?:\?|$)/.test(req.url);
      if (exclusive) return;
      const gate = { release: maintenance.enter(), sent: false, closed: false };
      gates.set(req, gate);
      reply.raw.once('close', () => {
        gate.closed = true;
        if (gate.sent) gate.release();
      });
    },
  );
  fastify.addHook(
    'onSend',
    async (req: object, reply: { raw: ServerResponse }, payload: unknown) => {
      const gate = gates.get(req);
      if (gate) {
        gate.sent = true;
        if (gate.closed || reply.raw.destroyed) gate.release();
      }
      return payload;
    },
  );
  const release = async (req: object) => {
    gates.get(req)?.release();
    gates.delete(req);
  };
  fastify.addHook('onResponse', release);
  fastify.addHook('onError', release);
  app.useGlobalFilters(new PrismaExceptionFilter());
}
