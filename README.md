# nest-fastify

NestJS 11 boilerplate on the **Fastify** adapter with a module structure split into
`core/` (infrastructure) and `modules/` (business features).

**Stack:** PostgreSQL (Prisma 7 + pg driver adapter), Redis + BullMQ, RabbitMQ
(`@nestjs/microservices`), Zod v4 validation via `nestjs-zod`, Swagger/OpenAPI, JWT auth
(Passport). Package manager: **pnpm**. Formatter/linter: **Biome**.

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d        # postgres, redis, rabbitmq
pnpm prisma:migrate         # apply migrations + generate the Prisma client
pnpm start:dev
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/docs (JSON at `/docs-json`)
- Health: http://localhost:3000/health
- RabbitMQ management UI: http://localhost:15673 (guest / guest)

> Infra ports are remapped to avoid clashing with other local stacks:
> Postgres **5433**, Redis **6380**, RabbitMQ **5673** (AMQP) / **15673** (UI).
> They are set in `docker-compose.yml` and `.env`.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm start:dev` | Run in watch mode |
| `pnpm start` | Run once |
| `pnpm build` | Production build to `dist/` |
| `pnpm start:prod` | Run the built app (`node dist/main.js`) |
| `pnpm test` | Unit tests (Jest) |
| `pnpm lint` | Biome check |
| `pnpm format` | Biome format (write) |
| `pnpm check` | Biome check + autofix |
| `pnpm prisma:migrate` | `prisma migrate dev` |
| `pnpm prisma:generate` | Regenerate the Prisma client |

## Project structure

```
src/
├── main.ts                 # Fastify bootstrap + Swagger + attached RabbitMQ microservice
├── app.module.ts           # global pipe/interceptor/filter/guard + module wiring
├── core/                   # infrastructure (no business logic)
│   ├── config/             # Zod-validated env (fail-fast)
│   ├── prisma/             # PrismaService (pg driver adapter) + @Global module
│   ├── queue/              # BullMQ root (Redis)
│   ├── messaging/          # RabbitMQ client (ClientsModule)
│   ├── guards/             # JwtAuthGuard (global; skips non-HTTP contexts)
│   ├── filters/ interceptors/ decorators/
│   └── health/             # GET /health
└── modules/                # business features
    ├── users/              # CRUD, Zod DTOs, password-safe responses
    ├── auth/               # register / login / me (Passport JWT)
    ├── mail/               # BullMQ producer + processor demo
    └── messaging/consumer/ # RabbitMQ publish + @EventPattern consumer demo
```

## How things fit together

- **Validation & serialization:** `ZodValidationPipe`, `ZodSerializerInterceptor` and
  `HttpExceptionFilter` are registered globally. DTOs are built with `createZodDto(...)`;
  responses are serialized through DTOs so fields like `password` never leak.
- **Auth:** `JwtAuthGuard` is a global `APP_GUARD` — every route requires a Bearer token
  unless annotated `@Public()` (login, register, health). The guard skips non-HTTP
  (microservice) execution contexts.
- **Config:** environment variables are validated by a Zod schema at startup; a missing or
  invalid value aborts the boot.
- **RabbitMQ:** the app is hybrid — `main.ts` attaches an RMQ microservice with
  `inheritAppConfig: true`, so `@EventPattern` handlers share the global pipe/filter stack.

## Prisma 7 notes

This project uses Prisma 7, which requires a **driver adapter** (`@prisma/adapter-pg`) and a
**`prisma.config.ts`** for CLI env loading (automatic `.env` loading was removed). The client
is generated into `src/generated/prisma` (gitignored); run `pnpm prisma:generate` after
cloning if the directory is absent.
