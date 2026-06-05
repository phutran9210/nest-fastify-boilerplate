import { randomUUID } from 'node:crypto';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
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
        return (Array.isArray(header) ? header[0] : header) ?? randomUUID();
      },
    }),
  );
  const config = app.get(ConfigService);

  // Permissive CORS for local/dev. Restrict `origin` (e.g. from an ALLOWED_ORIGINS env var)
  // before deploying to production.
  app.enableCors();

  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [config.getOrThrow<string>('RABBITMQ_URL')],
        queue: config.getOrThrow<string>('RABBITMQ_QUEUE'),
        queueOptions: { durable: true },
      },
    },
    { inheritAppConfig: true },
  );

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

  await app.startAllMicroservices();
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`HTTP on :${port} | Swagger at /docs`);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error(err);
  process.exit(1);
});
