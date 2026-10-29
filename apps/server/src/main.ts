import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication, FastifyAdapter } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { configureApp } from './bootstrap';
import { config } from './config';
import { proxyHops, proxyTrust } from './common/proxy';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const hops = proxyHops(process.env.TRUST_PROXY_HOPS);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // 直接访问 web 为 1；外层反代 → web → API 为 2（web 必须只允许外层反代访问）；外层反代前还有 Cloudflare 时为 3。
      trustProxy: proxyTrust(hops, process.env.TRUST_PROXY_CIDRS),
      bodyLimit: config.maxUploadBytes,
      logger: false,
    }),
  );

  await configureApp(app);
  app.enableShutdownHooks();

  await app.listen({ port: config.port, host: '0.0.0.0' });
  logger.log(`API 服务已启动: http://0.0.0.0:${config.port}/api`);
  logger.log(`数据目录: ${config.dataDir}`);
  logger.log(`可信反代: ${hops} 层`);
}

void bootstrap();
