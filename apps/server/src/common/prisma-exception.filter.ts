import {
  ArgumentsHost,
  Catch,
  ConflictException,
  ExceptionFilter,
  HttpException,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** 把 Prisma 已知错误码映射为友好的 HTTP 错误，其余按 500 记录 */
@Catch()
export class PrismaExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(PrismaExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      const mapped =
        exception.code === 'P2002'
          ? new ConflictException('数据违反唯一约束，请检查是否重复')
          : exception.code === 'P2025'
            ? new NotFoundException('记录不存在')
            : new InternalServerErrorException('数据库操作失败');
      this.logger.warn(`Prisma ${exception.code}: ${exception.message.slice(0, 200)}`);
      response.status(mapped.getStatus()).send(mapped.getResponse());
      return;
    }

    if (exception instanceof HttpException) {
      response.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    // fastify 生态抛出的原生错误（如 multipart 超限 413）：带 statusCode 就按它返回
    if (exception && typeof (exception as { statusCode?: unknown }).statusCode === 'number') {
      const status = (exception as { statusCode: number }).statusCode;
      const message = String((exception as { message?: unknown }).message ?? '请求处理失败');
      this.logger.warn(`Fastify error ${status}: ${message.slice(0, 200)}`);
      response.status(status).send({ statusCode: status, message });
      return;
    }

    this.logger.error(
      exception instanceof Error ? exception.stack ?? exception.message : String(exception),
    );
    const fallback = new InternalServerErrorException('服务器内部错误');
    response.status(fallback.getStatus()).send(fallback.getResponse());
  }
}
