import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Reuse an inbound correlation id if present; otherwise generate one. Surfaced back to
      // the client as `x-request-id` by ResponseInterceptor / HttpExceptionFilter.
      genReqId: (req) => {
        // A duplicated header arrives as string[]; take the first. Fall back to a fresh UUID.
        const header = req.headers['x-request-id'];
        const id = (Array.isArray(header) ? header[0] : header) ?? randomUUID();
        // Persist onto the header so Pino (pino-http genReqId in LoggerModule) reuses the SAME
        // id — logs' req.id then matches the x-request-id returned to the client.
        req.headers['x-request-id'] = id;
        return id;
      },
    }),
    // Buffer bootstrap logs until the Pino logger is wired below.
    { bufferLogs: true },
  );
  // Replace Nest's default logger with Pino (nestjs-pino) for the whole app.
  app.useLogger(app.get(Logger));
  const config = app.get(ConfigService);

  // Permissive CORS for local/dev. Restrict `origin` (e.g. from an ALLOWED_ORIGINS env var)
  // before deploying to production.
  app.enableCors();

  const openApiDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Nest Fastify API')
      .setDescription('NestJS + Fastify boilerplate')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(openApiDoc));

  app.enableShutdownHooks();
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`HTTP on :${port} | Swagger at /docs`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // App may not exist yet — fall back to console for fatal bootstrap failures.
  console.error(err);
  process.exit(1);
});
// test-hook-comment
