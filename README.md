# nest-fastify

NestJS 11 boilerplate on the **Fastify** adapter with a module structure split into
`common/` (cross-cutting), `core/` (infrastructure), and `modules/` (business features).

**Stack:** PostgreSQL (Prisma 7 + pg driver adapter), Redis + BullMQ, RabbitMQ
(`@nestjs/microservices`), Zod v4 validation via `nestjs-zod`, Swagger/OpenAPI, **Better Auth**
(email+password, Google/Facebook social, email verification, bearer tokens, admin/roles — mounted
on Fastify at `/api/auth/*`). Package manager: **pnpm**. Formatter/linter: **Biome**.

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d        # postgres, redis, rabbitmq
pnpm prisma:migrate         # apply migrations + generate the Prisma client
pnpm start:dev
```

- API: http://localhost:3000
- Auth endpoints (Better Auth): http://localhost:3000/api/auth/* (e.g. `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`) — served outside Nest, so NOT listed in Swagger
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
├── main.ts                    # Fastify bootstrap + Swagger + attached RabbitMQ microservice
├── app.module.ts              # global pipe/interceptor/filter/guard + module wiring
├── common/                    # cross-cutting concerns (no business logic)
│   ├── decorators/            # @Public() and other shared decorators
│   ├── filters/               # HttpExceptionFilter (global)
│   ├── guards/                # BetterAuthGuard + RolesGuard (global APP_GUARDs; cookie/bearer + @Roles)
│   └── interceptors/          # LoggingInterceptor (HTTP-only)
├── core/                      # infrastructure (no business logic)
│   ├── config/                # Zod-validated env (fail-fast)
│   ├── auth/                  # Better Auth instance (DI factory + @Global module + CLI config)
│   ├── prisma/                # PrismaService (pg driver adapter) + @Global module
│   ├── queue/                 # BullMQ root (Redis)
│   ├── messaging/             # RabbitMQ client (ClientsModule)
│   └── health/                # GET /health
└── modules/                   # business features (feature-first layout)
    ├── users/                 # read-only (list + get); identity owned by Better Auth
    │   ├── users.module.ts
    │   ├── controllers/
    │   ├── services/          # users.service.ts + users.service.spec.ts
    │   ├── repositories/      # user.repository.ts (port) + prisma-user.repository.ts (impl)
    │   └── dto/
    ├── auth/                  # thin: GET /auth/me only (sign-up/in handled by Better Auth at /api/auth/*)
    ├── mail/                  # BullMQ producer + processor demo
    └── notifications/         # RabbitMQ publish + @EventPattern consumer demo
```

## How things fit together

- **Validation & serialization:** `ZodValidationPipe`, `ZodSerializerInterceptor` and
  `HttpExceptionFilter` are registered globally. DTOs are built with `createZodDto(...)`;
  responses are serialized through DTOs so fields like `password` never leak.
- **Auth (Better Auth):** the Better Auth handler is mounted natively on Fastify at `/api/auth/*`
  (sign-up, sign-in, social, email verification, sessions) — outside Nest's pipeline and Swagger.
  A global `BetterAuthGuard` (`src/common/guards/`) protects every Nest route: it calls
  `auth.api.getSession({ headers })`, resolving **cookie or bearer** credentials, and sets
  `req.user`. Routes are public only when annotated `@Public()` (e.g. health, `/auth/me` is
  protected). Bearer clients read the token from the `set-auth-token` response header after
  sign-in and send `Authorization: Bearer <token>`. The guard skips non-HTTP (microservice)
  contexts. Set `BETTER_AUTH_SECRET` (≥32 chars) and `BETTER_AUTH_URL` in `.env`; Google/Facebook
  need their `*_CLIENT_ID`/`*_CLIENT_SECRET` pairs.
- **Admin (`admin()` plugin):** user management lives under `/api/auth/admin/*` (`list-users`,
  `create-user`, `set-role`, `ban-user`, `remove-user`, …). Roles are `user`/`admin`; seed admins
  via the `ADMIN_USER_IDS` env (CSV of user ids — recognized by both Better Auth and the Nest
  guard). Protect Nest routes with `@Roles('admin')`, enforced by a global `RolesGuard` that runs
  after `BetterAuthGuard` (allows when `req.user.role` matches or the user id is in `ADMIN_USER_IDS`).
- **Data access (repository port pattern):** each feature module exposes an `abstract class
  <Feature>Repository` (the port) that acts as both the TypeScript type and the NestJS DI
  token. A `Prisma<Feature>Repository` (the impl) extends it and is the only file that imports
  `PrismaService` or `generated/prisma`. Services depend on the port, not the impl — making
  them easy to test by swapping in a plain-object mock.
- **Config:** environment variables are validated by a Zod schema at startup; a missing or
  invalid value aborts the boot.
- **RabbitMQ:** the app is hybrid — `main.ts` attaches an RMQ microservice with
  `inheritAppConfig: true`, so `@EventPattern` handlers (in `modules/notifications/`) share
  the global pipe/filter stack.

## Prisma 7 notes

This project uses Prisma 7, which requires a **driver adapter** (`@prisma/adapter-pg`) and a
**`prisma.config.ts`** for CLI env loading (automatic `.env` loading was removed). The client
is generated into `src/generated/prisma` (gitignored); run `pnpm prisma:generate` after
cloning if the directory is absent.
