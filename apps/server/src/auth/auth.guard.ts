import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PrismaService } from '../prisma/prisma.service';
import { IS_PUBLIC_KEY } from '../common/public.decorator';
import { SessionService } from './session.service';
import { config } from '../config';

/**
 * 全局守卫：校验签名 Cookie（含密码纪元），并在请求通过后滑动续期。
 * 纪元不匹配（改密/恢复后）视同未登录，实现会话可吊销。
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly session: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<FastifyRequest>();
    const res = context.switchToHttp().getResponse<FastifyReply>();
    const token = (req.cookies as Record<string, string> | undefined)?.[config.session.cookieName];
    const payload = this.session.verify(token);
    if (!payload) throw new UnauthorizedException('未登录或登录已过期');

    const security = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    if (!security) throw new UnauthorizedException('系统尚未初始化');
    if (payload.epoch !== security.sessionEpoch) {
      throw new UnauthorizedException('登录已失效，请重新登录');
    }

    this.session.issue(res, req, security.sessionEpoch);
    return true;
  }
}
