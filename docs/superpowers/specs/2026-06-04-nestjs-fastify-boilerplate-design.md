# NestJS + Fastify Boilerplate — Design

**Date:** 2026-06-04
**Status:** Approved (design), pending spec review

## Goal

Thiết lập một boilerplate NestJS dùng Fastify adapter với hạ tầng đầy đủ: PostgreSQL (Prisma),
Redis + BullMQ, RabbitMQ, validation bằng Zod (nestjs-zod) và tài liệu OpenAPI bằng Swagger.
Cấu trúc theo module, tách rõ `core/` (hạ tầng dùng chung) và `modules/` (nghiệp vụ).

## Tech Stack (phiên bản hiện hành — tra cứu qua Context7)

| Mảng        | Thư viện |
|-------------|----------|
| Framework   | `@nestjs/core` 11, `@nestjs/common` 11, `@nestjs/platform-fastify` |
| ORM         | `prisma` + `@prisma/client` (PostgreSQL) |
| Queue       | `@nestjs/bullmq` + `bullmq` (Redis) |
| Messaging   | `@nestjs/microservices` (transport RMQ) + `amqplib` |
| Validation  | `zod` v4 + `nestjs-zod` |
| OpenAPI     | `@nestjs/swagger` + `@fastify/swagger` |
| Config      | `@nestjs/config` |
| Auth        | `@nestjs/jwt` + `@nestjs/passport` + `passport` + `passport-jwt` + `bcrypt` |
| DX          | pnpm, Docker Compose, ESLint, Prettier |

**Lưu ý API mới (Context7):**
- `nestjs-zod` bản mới: dùng `cleanupOpenApiDoc(openApiDoc)` (thay cho `patchNestJsSwagger()` đã deprecated)
  và Zod v4 qua `z.toJSONSchema()`.
- DTO: `class XDto extends createZodDto(zSchema) {}`.
- Global: `ZodValidationPipe` (APP_PIPE), `ZodSerializerInterceptor` (APP_INTERCEPTOR),
  `HttpExceptionFilter` xử lý `ZodSerializationException` (APP_FILTER).

## Folder Structure

```
src/
├── main.ts                      # bootstrap Fastify + Swagger + connect RMQ microservice (hybrid)
├── app.module.ts                # wiring global pipe/interceptor/filter + import core & modules
├── core/                        # hạ tầng dùng chung, KHÔNG chứa nghiệp vụ
│   ├── config/
│   │   ├── config.module.ts     # ConfigModule.forRoot isGlobal + validate bằng Zod
│   │   ├── env.schema.ts        # Zod schema cho biến môi trường (fail-fast)
│   │   └── configuration.ts     # config namespaces (app, db, redis, rmq, jwt)
│   ├── prisma/
│   │   ├── prisma.module.ts     # @Global
│   │   └── prisma.service.ts    # extends PrismaClient, onModuleInit/onModuleDestroy
│   ├── queue/
│   │   └── queue.module.ts      # BullModule.forRootAsync (Redis từ config), @Global
│   ├── messaging/
│   │   └── messaging.module.ts  # ClientsModule.registerAsync (RMQ producer client), @Global
│   ├── filters/
│   │   └── http-exception.filter.ts
│   ├── interceptors/
│   │   └── logging.interceptor.ts
│   ├── guards/
│   │   └── jwt-auth.guard.ts     # AuthGuard('jwt') + tôn trọng @Public
│   └── decorators/
│       ├── current-user.decorator.ts
│       └── public.decorator.ts
├── modules/                     # business modules
│   ├── users/
│   │   ├── users.module.ts
│   │   ├── users.controller.ts  # CRUD, Swagger decorated
│   │   ├── users.service.ts     # dùng PrismaService
│   │   └── dto/
│   │       ├── create-user.dto.ts   # zod schema + createZodDto
│   │       └── update-user.dto.ts
│   ├── auth/
│   │   ├── auth.module.ts        # JwtModule.registerAsync
│   │   ├── auth.controller.ts    # register, login
│   │   ├── auth.service.ts       # validate user, sign JWT, bcrypt
│   │   ├── jwt.strategy.ts       # PassportStrategy(Strategy from passport-jwt)
│   │   └── dto/ (login.dto.ts, register.dto.ts)
│   └── mail/
│       ├── mail.module.ts        # BullModule.registerQueue({ name: 'mail' })
│       ├── mail.producer.ts      # inject Queue, add job
│       ├── mail.processor.ts     # @Processor('mail') WorkerHost
│       └── mail.controller.ts    # endpoint demo enqueue job
└── messaging/
    └── consumer/
        └── notifications.controller.ts  # @EventPattern/@MessagePattern (RMQ consumer demo)
```

## Key Integration Points

### main.ts
- `NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter())`.
- `app.connectMicroservice<MicroserviceOptions>({ transport: Transport.RMQ, options: { urls, queue } })`
  để chạy hybrid (HTTP + RMQ consumer trong cùng app).
- Swagger: `SwaggerModule.setup('docs', app, cleanupOpenApiDoc(openApiDoc))`.
- `app.startAllMicroservices()` rồi `app.listen(port, '0.0.0.0')`.

### app.module.ts
- Import: `CoreConfigModule`, `PrismaModule`, `QueueModule`, `MessagingModule`, và các business module.
- Providers global: `{ APP_PIPE: ZodValidationPipe }`, `{ APP_INTERCEPTOR: ZodSerializerInterceptor }`,
  `{ APP_FILTER: HttpExceptionFilter }`.

### Config + Zod env validation
- `env.schema.ts` định nghĩa Zod schema (DATABASE_URL, REDIS_HOST/PORT, RABBITMQ_URL, JWT_SECRET, …).
- `ConfigModule.forRoot({ isGlobal: true, validate: (env) => EnvSchema.parse(env) })` → fail-fast khi thiếu env.

### Prisma
- `schema.prisma`: datasource postgresql, generator client; model `User` mẫu (id, email unique, password, name, timestamps).
- `PrismaService` extends `PrismaClient`, connect trong `onModuleInit`.
- Migration ban đầu qua `prisma migrate dev`.

### BullMQ (queue mẫu)
- `QueueModule`: `BullModule.forRootAsync` lấy host/port Redis từ config (@Global).
- `mail` module: `registerQueue({ name: 'mail' })`, `MailProducer` add job, `MailProcessor` (WorkerHost) xử lý.

### RabbitMQ
- `MessagingModule`: `ClientsModule.registerAsync` với RMQ transport → `MessagingClient` để publish (`emit`/`send`).
- Consumer demo: controller dùng `@EventPattern('notification.created')` nhận message từ queue RMQ.

### Auth (Passport JWT)
- `register`: hash password (bcrypt), tạo user.
- `login`: validate, ký JWT (`@nestjs/jwt`).
- `JwtStrategy` (passport-jwt) đọc Bearer token; `JwtAuthGuard` (AuthGuard('jwt')) + `@Public()` bypass.

## Docker & DX
- `docker-compose.yml`: `postgres`, `redis`, `rabbitmq` (image `rabbitmq:3-management`, UI 15672).
- `.env.example` đầy đủ biến.
- Scripts (pnpm): `start:dev`, `start`, `build`, `prisma:generate`, `prisma:migrate`, `lint`, `format`.
- `nest-cli.json`, cập nhật `tsconfig.json` (experimentalDecorators, emitDecoratorMetadata, target ES2021+, paths `@app/*`).
- ESLint + Prettier config tối giản.

## Testing Strategy
- Smoke: `pnpm build` (tsc) phải pass.
- App bootstrap được (start, Swagger `/docs` truy cập được) — kiểm tra thủ công với docker-compose up.
- Unit test mẫu cho `UsersService` / `AuthService` (Jest) — tuỳ chọn ở plan, giữ tối thiểu 1 spec mẫu.

## Out of Scope (YAGNI)
- RBAC/permission nâng cao, refresh token rotation.
- CI/CD pipeline.
- Nhiều business module ngoài users/auth/mail.
- E2E test suite đầy đủ (chỉ giữ smoke + 1-2 unit mẫu).
