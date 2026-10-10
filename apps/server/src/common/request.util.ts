import { BadRequestException } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';

/**
 * 客户端 IP：fastify 在 trustProxy 配置下已按可信跳数解析 X-Forwarded-For，
 * req.ip 取最右侧不可伪造条目，无需手动拆头。
 */
export function clientIp(req: FastifyRequest): string | undefined {
  return req.ip?.replace('::ffff:', '') || undefined;
}

export function operationId(req: FastifyRequest): string {
  const value = req.headers['idempotency-key'];
  if (value === undefined)
    throw new BadRequestException('缺少 Idempotency-Key 操作编号，请刷新客户端后重试');
  if (typeof value !== 'string' || !/^[0-9a-f-]{36}$/i.test(value))
    throw new BadRequestException('操作编号无效');
  return value;
}
