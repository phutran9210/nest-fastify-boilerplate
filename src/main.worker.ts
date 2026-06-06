import { createBullBoardAuthHook } from '@common/auth/basic-auth';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter();

  // Gắn auth hook vào instance TRƯỚC khi Nest init/ready → áp được cho route do Bull Board
  // (plugin Fastify) đăng ký. Đọc creds qua process.env vì ConfigService chưa có lúc này;
  // production vẫn được CoreConfigModule fail-fast nếu thiếu BULLBOARD_PASSWORD.
  const user = process.env.BULLBOARD_USER ?? 'admin';
  const pass = process.env.BULLBOARD_PASSWORD ?? 'admin';
  adapter.getInstance().addHook('onRequest', createBullBoardAuthHook('/admin/queues', user, pass));

  const app = await NestFactory.create<NestFastifyApplication>(WorkerModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const port = app.get(ConfigService).getOrThrow<number>('WORKER_PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`Worker on :${port} | Bull Board at /admin/queues`, 'WorkerBootstrap');
}

bootstrap().catch((err) => {
  // App có thể chưa tồn tại — fallback console cho lỗi bootstrap.
  console.error(err);
  process.exit(1);
});
