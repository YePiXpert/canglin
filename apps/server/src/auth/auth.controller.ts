import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AuthService } from './auth.service';
import { SessionService } from './session.service';
import { Public } from '../common/public.decorator';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { clientIp } from '../common/request.util';
import { config } from '../config';
import { changePasswordSchema, loginSchema, setupSchema } from '@canglin/shared';

/**
 * @Public 只标注在真正公开的路由上（类级标注会让 change-password 等
 * 敏感接口免鉴权，形成绕过锁定阈值的在线猜密码通道）。
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly session: SessionService,
  ) {}

  @Public()
  @Get('status')
  async status(@Req() req: FastifyRequest) {
    // authenticated 依据会话 Cookie 现场验证，前端据此恢复登录态
    const token = (req.cookies as Record<string, string> | undefined)?.[config.session.cookieName];
    const base = await this.auth.status();
    return { ...base, authenticated: !!this.session.verify(token) };
  }

  @Public()
  @Post('setup')
  setup(
    @Body(new ZodValidationPipe(setupSchema)) body: { password: string },
    @Req() req: FastifyRequest,
  ) {
    return this.auth.setup(body.password, clientIp(req));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) body: { password: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const epoch = await this.auth.login(body.password, clientIp(req));
    this.session.issue(res, req, epoch);
    return { ok: true };
  }

  @Public()
  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: FastifyReply) {
    this.session.clear(res);
    return { ok: true };
  }

  @Public()
  @Post('recover')
  @HttpCode(200)
  recover(
    @Body(
      new ZodValidationPipe(
        z.object({ recoveryCode: z.string().min(1), newPassword: z.string().min(8).max(128) }),
      ),
    )
    body: { recoveryCode: string; newPassword: string },
    @Req() req: FastifyRequest,
  ) {
    return this.auth.recover(body.recoveryCode, body.newPassword, clientIp(req));
  }

  /* 以下需要登录（无 @Public） */

  @Post('change-password')
  @HttpCode(200)
  changePassword(
    @Body(new ZodValidationPipe(changePasswordSchema))
    body: { currentPassword: string; newPassword: string },
    @Req() req: FastifyRequest,
  ) {
    return this.auth.changePassword(body.currentPassword, body.newPassword, clientIp(req));
  }

  @Post('recovery-code')
  @HttpCode(200)
  regenerateRecoveryCode(
    @Body(new ZodValidationPipe(loginSchema)) body: { password: string },
    @Req() req: FastifyRequest,
  ) {
    return this.auth.regenerateRecoveryCode(body.password, clientIp(req));
  }
}
