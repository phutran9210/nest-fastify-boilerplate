import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { fromNodeHeaders } from 'better-auth/node';
import { Logger } from 'nestjs-pino';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';
import { AUTH_INSTANCE, type AuthInstance } from './core/auth/auth';

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

  const allowedOrigins = config.get<string[]>('ALLOWED_ORIGINS') ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });

  // Mount Better Auth on a Fastify catch-all using the documented Fetch bridge.
  // Forward response headers verbatim so Set-Cookie AND set-auth-token reach the client.
  const auth: AuthInstance = app.get(AUTH_INSTANCE);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => {
        reply.header(key, value);
      });
      return reply.send(response.body ? await response.text() : null);
    },
  });

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
