import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import crypto from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { config } from '../config';

const RECOVERY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export interface AuthStatus {
  initialized: boolean;
  locked: boolean;
  lockRemainingSeconds: number;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async status(): Promise<AuthStatus> {
    const row = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    const lockedUntil = row?.lockedUntil;
    const locked = !!lockedUntil && lockedUntil.getTime() > Date.now();
    return {
      initialized: !!row,
      locked,
      lockRemainingSeconds: locked ? Math.ceil((lockedUntil!.getTime() - Date.now()) / 1000) : 0,
    };
  }

  /** 首次初始化：设置密码并生成恢复码（明文只返回一次）。返回新会话纪元。 */
  async setup(password: string, ip?: string): Promise<{ recoveryCode: string; sessionEpoch: number }> {
    const exists = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    if (exists) throw new ConflictException('系统已初始化，不能重复设置密码');
    const recoveryCode = this.generateRecoveryCode();
    const row = await this.prisma.systemSecurity.create({
      data: {
        id: 1,
        passwordHash: await argonHash(password),
        recoveryCodeHash: await argonHash(recoveryCode),
        sessionEpoch: 1,
      },
    });
    await this.audit.log('AUTH_SETUP', { entity: 'system', ip });
    return { recoveryCode, sessionEpoch: row.sessionEpoch };
  }

  /** 癔回当前会话纪元（登录成功后签发 Cookie 用）。 */
  async login(password: string, ip?: string): Promise<number> {
    const row = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('系统尚未初始化');

    this.assertNotLocked(row.lockedUntil);

    const ok = await argonVerify(row.passwordHash, password).catch(() => false);
    if (!ok) {
      // 原子递增失败计数：并发猜测不会互相覆盖
      await this.prisma.systemSecurity.updateMany({
        where: { id: 1, failedAttempts: { lt: config.session.maxFailedAttempts } },
        data: { failedAttempts: { increment: 1 } },
      });
      const after = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
      const locked = (after?.failedAttempts ?? 0) >= config.session.maxFailedAttempts;
      if (locked) {
        await this.prisma.systemSecurity.update({
          where: { id: 1 },
          data: {
            failedAttempts: 0,
            lockedUntil: new Date(Date.now() + config.session.lockMinutes * 60_000),
          },
        });
      }
      await this.audit.log('AUTH_LOGIN_FAILED', { entity: 'system', detail: { locked }, ip });
      throw new UnauthorizedException(locked ? '密码错误次数过多，账号已锁定' : '密码错误');
    }

    if (row.failedAttempts > 0 || row.lockedUntil) {
      await this.prisma.systemSecurity.update({
        where: { id: 1 },
        data: { failedAttempts: 0, lockedUntil: null },
      });
    }
    await this.audit.log('AUTH_LOGIN', { entity: 'system', ip });
    return row.sessionEpoch;
  }

  async recover(recoveryCode: string, newPassword: string, ip?: string): Promise<void> {
    const row = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    if (!row?.recoveryCodeHash) throw new UnauthorizedException('恢复码不可用');

    // 恢复码同样受锁定保护，防止在线暴力枚举
    this.assertNotLocked(row.lockedUntil);

    const ok = await argonVerify(row.recoveryCodeHash, recoveryCode).catch(() => false);
    if (!ok) {
      await this.prisma.systemSecurity.updateMany({
        where: { id: 1, failedAttempts: { lt: config.session.maxFailedAttempts } },
        data: { failedAttempts: { increment: 1 } },
      });
      await this.audit.log('AUTH_RECOVER_FAILED', { entity: 'system', ip });
      throw new UnauthorizedException('恢复码错误');
    }

    const nextCode = this.generateRecoveryCode();
    await this.prisma.systemSecurity.update({
      where: { id: 1 },
      data: {
        passwordHash: await argonHash(newPassword),
        recoveryCodeHash: await argonHash(nextCode),
        failedAttempts: 0,
        lockedUntil: null,
        sessionEpoch: { increment: 1 }, // 旧会话全部失效
      },
    });
    await this.audit.log('AUTH_RECOVER', { entity: 'system', ip });
  }

  async changePassword(currentPassword: string, newPassword: string, ip?: string): Promise<void> {
    const row = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('系统尚未初始化');
    const ok = await argonVerify(row.passwordHash, currentPassword).catch(() => false);
    // 已登录时核对密码失败用 403：401 只表示会话失效，前端据此弹重新登录
    if (!ok) throw new ForbiddenException('当前密码错误');
    await this.prisma.systemSecurity.update({
      where: { id: 1 },
      data: {
        passwordHash: await argonHash(newPassword),
        sessionEpoch: { increment: 1 }, // 改密后踢掉所有既有会话
      },
    });
    await this.audit.log('AUTH_CHANGE_PASSWORD', { entity: 'system', ip });
  }

  /** 重新生成恢复码（明文只返回一次） */
  async regenerateRecoveryCode(password: string, ip?: string): Promise<{ recoveryCode: string }> {
    const row = await this.prisma.systemSecurity.findUnique({ where: { id: 1 } });
    if (!row) throw new UnauthorizedException('系统尚未初始化');
    const ok = await argonVerify(row.passwordHash, password).catch(() => false);
    if (!ok) throw new ForbiddenException('密码错误');
    const recoveryCode = this.generateRecoveryCode();
    await this.prisma.systemSecurity.update({
      where: { id: 1 },
      data: { recoveryCodeHash: await argonHash(recoveryCode) },
    });
    await this.audit.log('AUTH_REGENERATE_RECOVERY', { entity: 'system', ip });
    return { recoveryCode };
  }

  private assertNotLocked(lockedUntil: Date | null): void {
    if (lockedUntil && lockedUntil.getTime() > Date.now()) {
      const remain = Math.ceil((lockedUntil.getTime() - Date.now()) / 1000);
      throw new HttpException(
        { statusCode: 429, message: `失败次数过多已锁定，请 ${remain} 秒后重试` },
        429,
      );
    }
  }

  private generateRecoveryCode(): string {
    const bytes = crypto.randomBytes(16);
    let code = '';
    for (const b of bytes) code += RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length];
    return code;
  }
}
