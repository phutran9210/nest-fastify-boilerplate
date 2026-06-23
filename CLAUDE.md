# nest-fastify — CLAUDE.md

Concise documentation for Claude. Read carefully before generating code.

---

## Stack

| Layer | Library / Tool |
|---|---|
| Framework | NestJS 11 + Fastify (`@nestjs/platform-fastify`) |
| ORM | Prisma 7 — generator `prisma-client` (ESM), client at `src/generated/prisma`, import from `src/generated/prisma/client`, driver adapter `@prisma/adapter-pg` |
| Validation / Serialization | nestjs-zod + Zod 4 — global `ZodValidationPipe` + `ZodSerializerInterceptor` |
| Auth | Better Auth (`better-auth`) — email+password, Google/Facebook social, email verification, bearer plugin; mounted natively on Fastify at `/api/auth/*`; global `BetterAuthGuard` validates cookie/bearer sessions |
| Queue / Messaging | BullMQ (`@nestjs/bullmq`) running in a **separate worker process** + Bull Board (`@bull-board/*`); RabbitMQ (`@golevelup/nestjs-rabbitmq`) — quorum topology + DLX + retry-tier + alternate-exchange; producer in API, consumer + outbox relay in **worker** |
| Date/Time | `@js-temporal/polyfill` (Temporal API) |
| Logging | Pino (`nestjs-pino`) — global `LoggerModule` at `src/core/logger/`; `pino-pretty` only in dev, prod uses JSON; replace Nest logger via `app.useLogger` |
| Tooling | Biome (lint + format), Jest, pnpm |
| API Docs | Swagger UI at `/docs` — built with `cleanupOpenApiDoc` from nestjs-zod |

---

## Main commands (pnpm — DO NOT use npm/yarn)

```bash
pnpm start:dev        # Start API (producer) dev server
pnpm start:worker:dev # Start Worker process (BullMQ + Bull Board) — watch
pnpm test             # Run all Jest unit tests
pnpm test:e2e         # Run e2e (jest.e2e.config.js, test/e2e/*.e2e-spec.ts)
pnpm check            # Biome format + lint --write
pnpm lint             # Biome lint (no write)
pnpm prisma:migrate   # Run Prisma migrations
pnpm prisma:generate  # Generate Prisma client
```

> Production worker: `pnpm start:worker:prod` (= `node dist/src/main.worker.js`). `nest build` compiles BOTH entrypoints (`main`, `main.worker`).

---

## Core conventions

### `any` — DO NOT use in `src/` (TS any is forbidden in production code)
- **DO NOT use `any` in production code (`src/`)**, including `as any`. No exceptions "with a comment".
- **Exception: `any` is accepted in test files** (`test/**`, `*.spec.ts`) for test doubles. Biome only lints `src/**` so tests are not enforced.
- Untyped APIs (e.g. custom Lua command ioredis via `defineCommand`) → **declare an explicit interface** (see `RedisLockClient` in `src/core/redis/services/lock.service.ts`), DO NOT cast `any`.
- Need to cast through a different shape → go through `unknown` (`x as unknown as T`), NOT through `any`.
- `z.any()` from Zod (e.g. Date pattern in response DTO) is a library runtime API — NOT TypeScript `any` → still allowed.
- `useImportType` is off — `import type` is NOT required.
- Note: Biome `noExplicitAny` is currently off (not auto-enforced) — this rule is enforced via review/`/review-code`. A few legacy files (`rate-limit.service.ts`, `pubsub.service.ts`, `api-envelope.decorator.ts`) still have `any`; clean them up before enabling `noExplicitAny` in `biome.json`.

### Auth — Better Auth + `@Public()` opt-out
- **Better Auth** owns authentication. Its handler is mounted as a **native Fastify catch-all at `/api/auth/*`** in `main.ts` (via the `auth.handler(Request)` Fetch bridge) — these routes live OUTSIDE Nest's pipeline and OUTSIDE Nest Swagger (`/docs`). All sign-up/sign-in/social/verify-email/session endpoints are served there (e.g. `POST /api/auth/sign-up/email`, `POST /api/auth/sign-in/email`, `GET /api/auth/sign-in/social`).
- The Better Auth instance is built via DI in `src/core/auth/` (`BetterAuthModule`, `@Global`, token `AUTH_INSTANCE`); `auth-options.ts` holds the pure options shared with the CLI (`auth.cli.ts`, schema generation only). Email verification enqueues through the existing BullMQ `mail` queue; the `user.create` hook enqueues `user.registered` to the outbox (best-effort, non-transactional).
- Global `BetterAuthGuard` (`src/common/guards/better-auth.guard.ts`) protects EVERY Nest route by default — it calls `auth.api.getSession({ headers })`, resolving **both cookie and bearer** credentials (the `bearer()` plugin reads `Authorization`), and sets `req.user = { userId, email, role }`. Non-HTTP (RMQ/BullMQ) contexts are skipped.
- **Bearer clients:** after sign-in, read the token from the **`set-auth-token`** response header and send it as `Authorization: Bearer <token>` on later requests.
- To expose a public route: apply decorator `@Public()` (from `src/common/decorators/public.decorator.ts`).
- Controllers requiring auth: `ApiBearerAuth()` goes INSIDE the module's composite decorator (see the Swagger section below), NOT directly on the controller.
- DB schema is owned by Better Auth (`user`/`session`/`account`/`verification` models, generated via `@better-auth/cli generate` against `auth.cli.ts`). The Users module is **read-only** (`GET /users`, `GET /users/:id`) — user creation goes through `/api/auth/sign-up/email`, never `POST /users`.

### Admin — `admin()` plugin + `@Roles()` / `RolesGuard`
- The Better Auth **`admin()` plugin** (`auth-options.ts`, `defaultRole:'user'`, `adminRoles:['admin']`) serves user-management endpoints under the same mount: `/api/auth/admin/*` (`list-users`, `create-user`, `set-role`, `ban-user`, `unban-user`, `remove-user`, `list-user-sessions`...). It adds `role`/`banned`/`banReason`/`banExpires` to `user` and `impersonatedBy` to `session`. Authorization for these endpoints is enforced **inside** Better Auth.
- **Seed admins via `ADMIN_USER_IDS`** (env, CSV). These ids are treated as admin by both Better Auth (`adminUserIds`) AND the Nest `RolesGuard`. To set a persistent DB `role='admin'`, call `POST /api/auth/admin/set-role` from an existing admin. (Banned users: Better Auth revokes their sessions → `getSession` returns null → `BetterAuthGuard` rejects them automatically.)
- **Protect Nest routes by role:** `@Roles('admin')` (from `src/common/decorators/roles.decorator.ts`) + the global `RolesGuard` (`src/common/guards/roles.guard.ts`, registered as a 2nd `APP_GUARD` AFTER `BetterAuthGuard`). Logic: no `@Roles` → allow; else allow if `req.user.role` ∈ roles **OR** `userId ∈ ADMIN_USER_IDS`; else 403.
- **Impersonation is intentionally not used.** With default roles the `admin` role still carries the permission, so `/api/auth/admin/impersonate-user` remains reachable by admins; fully blocking it needs custom access control (out of scope).
- Only two roles exist: `user` / `admin` (no custom access-control / permissions).

### Logging — Pino (nestjs-pino)
- Global logger configured at `src/core/logger/logger.module.ts`; `main.ts` replaces the Nest logger via `app.useLogger(app.get(Logger))` (Logger from `nestjs-pino`) + `bufferLogs: true`.
- In services/controllers: use `Logger` from `@nestjs/common` (already routed through Pino) or inject `PinoLogger` from `nestjs-pino`. **DO NOT use `console.log`.**
- Request logging is automatic via pino-http — DO NOT write custom request-logging interceptors.
- Level: `LOG_LEVEL` env (default `debug` in dev, `info` in prod).
- **Redact sensitive data**: path list at `src/core/logger/log-redact.ts` (`authorization`, `cookie`, `password`, `token`, `secret`... both top-level and `*.x`). Add new sensitive fields to this file.
- **File logging (optional)**: `LOG_FILE_ENABLED=true` → combined file `app.<date>.N.log` in `LOG_DIR` (default `logs/`). Rotates on **new day OR file exceeds `LOG_FILE_MAX_SIZE`** (default `50m`); keeps `LOG_FILE_MAX_DAYS` most recent files (default 30) via `pino-roll`. Console still logs in parallel.
- **Separate error file (optional)**: `LOG_ERROR_FILE_ENABLED=true` → adds `error.<date>.N.log` containing ONLY level>=error (errors also go to the combined file → maintains correlation).
- **Log filtering scripts** (jq + pino-pretty): `pnpm logs` (pretty view), `pnpm logs:tail` (live), `pnpm logs:err` (errors only), `pnpm logs:warn` (warn+), `pnpm logs:errfile` (view separate error file).
- `req.id` in logs == `x-request-id` header returned to client (same source from Fastify `genReqId`).

### Swagger — centralized in `decorators/`
- EVERY controller has a file `<module>/decorators/<feature>-api.decorator.ts` containing all Swagger metadata as composite `applyDecorators`.
- Class-level: `Api<Feature>Controller()` — combines `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` if auth is needed).
- Per-endpoint: `Api<Action>()` — combines `ApiEnvelopeResponse(...)` and route-specific metadata.
- Controllers **DO NOT** import directly from `@nestjs/swagger` — only import `Api*()` from `decorators/`.
- Applies to EVERY controller, even routes with only `ApiTags` (mail, notifications, health...).
- Reference module: `src/modules/users/decorators/users-api.decorator.ts`.

### HTTP status — explicit `@HttpCode`, use `HttpStatus` from `@nestjs/common`
- EVERY HTTP route **MUST** declare `@HttpCode(HttpStatus.X)` explicitly — DO NOT rely on Nest's implicit defaults (POST->201, others->200).
- `status` in `ApiEnvelopeResponse(..., { status: HttpStatus.X })` MUST match the **same** `HttpStatus.X` as `@HttpCode` → runtime and Swagger always stay in sync.
- DO NOT use magic numbers (`201`, `202`...) — always use the `HttpStatus` enum (`CREATED`, `OK`, `ACCEPTED`, `NO_CONTENT`...).
- Status conventions: create resource → `CREATED` (201); read/update/delete returning body → `OK` (200); async action (enqueue/publish) → `ACCEPTED` (202).

### Date in response DTO — DO NOT use `z.date()`
- `z.date()` causes `z.toJSONSchema()` (used by nestjs-zod for Swagger) to crash — **app will not boot**.
- Replace with:
  ```ts
  z.any().transform((v) => v instanceof Date ? v.toISOString() : String(v))
  ```
- This is the mandatory pattern for every Date field in response DTOs.

### Date/time logic uses Temporal
- Import: `import { Temporal, toTemporalInstant } from '@js-temporal/polyfill'`
- Convert Prisma `Date` to Temporal: `toTemporalInstant.call(date)` (NOT `date.toTemporalInstant()`).
- Avoid using `new Date()` for business logic.

### Project structure — feature-first, with clear layering

```
src/
├── main.ts          # entrypoint API (producer, :PORT)
├── main.worker.ts   # entrypoint Worker (BullMQ + Bull Board + RMQ consumer, :WORKER_PORT)
├── app.module.ts    # root module API
├── worker.module.ts # root module Worker (Redis + Prisma + RMQ consumer + Outbox relay)
├── common/          # cross-cutting concerns
│   ├── auth/        # basic-auth.ts (verifyBasicAuth + Fastify hook for Bull Board)
│   ├── decorators/  # @Public(), @Roles(), @CurrentUser()
│   ├── filters/     # HttpExceptionFilter
│   ├── guards/      # BetterAuthGuard + RolesGuard (both global APP_GUARD)
│   └── interceptors/
├── core/            # infrastructure (no business logic)
│   ├── config/      # Zod-validated env
│   ├── auth/        # Better Auth: auth-options.ts (pure) + auth.ts (DI factory, AUTH_INSTANCE) + auth.module.ts (@Global) + auth.cli.ts (schema-gen)
│   ├── prisma/      # PrismaService (@Global)
│   ├── queue/       # BullMQ root
│   ├── messaging/   # RabbitMQ client
│   ├── redis/        # RedisModule @Global: Cache/Lock/RateLimit/PubSub (ioredis + port pattern)
│   └── health/      # GET /health (reused in both API and Worker)
└── modules/         # business features
    ├── users/
    │   ├── users.module.ts
    │   ├── controllers/
    │   ├── decorators/    # Centralized Swagger — composite @Api*()
    │   ├── services/      # *.service.ts (tests in test/unit/, NOT colocated)
    │   ├── repositories/  # *.repository.port.ts (PORT) + *.repository.prisma.ts (IMPL)
    │   └── dto/
    ├── auth/                 # thin: only GET /auth/me (session-backed); sign-up/in served by Better Auth at /api/auth/*
    ├── mail/                 # mail.module.ts (producer) + mail-worker.module.ts (processor)
    │   └── jobs/             # mail.producer.ts, mail.processor.ts
    └── notifications/     # RabbitMQ consumer (NotificationsConsumerModule)
```

- **Path aliases for cross-module/layer imports** — declared in `tsconfig.json` (`paths`), `.swcrc` (`jsc.baseUrl` + `jsc.paths`) and `jest.config.js` (`moduleNameMapper`):
  - `@common/*` → `src/common/*`
  - `@core/*` → `src/core/*`
  - `@modules/*` → `src/modules/*`
  - `@generated/*` → `src/generated/*`
  - Use aliases when importing outside the current module/layer (previously `../../../`). Example: `@common/decorators/public.decorator`, `@modules/users/dto/user-response.dto`, `@generated/prisma/client`.
  - **Imports within the same module** (same `<feature>/` folder) still use short relative paths (`./`, `../dto/`, `../services/`) — DO NOT use aliases.
  - SWC rewrites aliases → relative paths at build time (see `dist/`), so runtime does not need `tsconfig-paths`.
- Do not create barrel `index.ts` files.
- Module files (`<feature>.module.ts`) live directly in `src/modules/<feature>/`.

### Repository port pattern — data access

- **Services inject PORT** (`abstract class <Feature>Repository`) — DO NOT inject `PrismaService` directly.
- **Naming by role (suffix):** PORT = `<feature>.repository.port.ts`, IMPL = `<feature>.repository.prisma.ts` — the file suffix tells you the role. Switching adapter → `<feature>.repository.<adapter>.ts` (e.g. `.mongo.ts`).
- **PORT** (`repositories/<feature>.repository.port.ts`): `abstract class` serves as both TS type AND DI token; re-exports model type via `export type { <Model> }`; defines `Create<F>Data` / `Update<F>Data`.
- **Prisma impl** (`repositories/<feature>.repository.prisma.ts`): the ONLY file that imports `PrismaService` and `generated/prisma`.
- **Module wiring**: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`.
- Services import model types FROM PORT, not directly from `generated/prisma`.

See `src/modules/users/` as the most accurate reference module.

### Redis — inject PORT, do not inject REDIS_CLIENT directly in business modules
- Business modules only inject ports: `CacheService`, `LockService`, `RateLimitService`, `PubSubService`.
- DO NOT inject `REDIS_CLIENT` / `REDIS_SUBSCRIBER` symbols directly outside `src/core/redis/` (except `HealthController`).
- Lock and RateLimit run atomically via Lua scripts — do not use plain get+set.
- `LockService` supports: `acquire`/`withLock` with `opts?` — `retry` (wait + full-jitter backoff, monotonic deadline), `autoRenew` (watchdog self-scheduling, **best-effort liveness NOT safety**, requires `ttlMs >= 3000`), `fencing` (**opt-in** — does NOT create `lock:fence:*` keys by default to avoid leaks; only enable when actually comparing fencing tokens at write points), `onTimeout: 'throw'|'return'`. `withLock` defaults to throw 409 (overload keeps `Promise<T>`); `onTimeout:'return'` → `Promise<T | undefined>`, does NOT run fn.
- Lock key business format: `<domain>:<id>[:<action>]` (e.g. `user:42:sync`); callers DO NOT prepend `lock:` themselves. High key cardinality → keep `fencing` off.
- Decorator `@WithLock({ key: (...args) => string, ttlMs, retry?, autoRenew?, onTimeout? })` (from `@core/redis/decorators/with-lock.decorator`) wraps internal service methods; uses a "service holder" set during the `RedisModule` lifecycle. If you need loss-awareness (`lock.signal`), use `withLock(...)` directly, DO NOT use the decorator.
- PubSub (ioredis) does not replace RabbitMQ for durable/fanout cross-service needs.
- `buildRedisBaseOptions` is shared with BullMQ (DO NOT add `keyPrefix` to BullMQ — it has its own prefix mechanism).

### RabbitMQ / Messaging — `@golevelup/nestjs-rabbitmq`

- **MessagingModule** (`src/core/messaging/`): `MessagingModule.forRoot({ consumer })` — API loads with `consumer: false` (producer-only, `registerHandlers: false`); Worker loads with `consumer: true` (registers handlers + asserts topology).
- **Exchanges** (names derived from env `RABBITMQ_EXCHANGE`, default `app`):
  - `app.events` (topic) — main exchange, with `alternate-exchange: app.unrouted`.
  - `app.retry` (topic) — retry-tier queues bind to this.
  - `app.dlx` (topic) — dead-letter exchange; messages that exhaust retries go to DLQ.
- **Centralized topology** at `src/core/messaging/topology.ts` — asserts all queues/exchanges when worker starts. Consumers use `@RabbitSubscribe({ createQueueIfNotExists: false })` (DO NOT let golevelup auto-create queues).
- **Per-subscription queue**: `<subscriber>.<event>.q` (quorum) + retry-tier queues (durable, increasing TTL) + `<subscriber>.<event>.dlq` (quorum).
- **Zod contracts** at `src/core/messaging/messaging.contracts.ts`: object `EventContracts` maps `routingKey → Zod schema`; `SUBSCRIPTIONS` list. Adding a new event = add 1 entry to `EventContracts` + 1 entry to `SUBSCRIPTIONS` + handler.
- **Publish**: `EventPublisherService.publish(routingKey, payload, opts?)` — validates payload against contract before sending. Used in both API and worker.
- **Consume**: `MessageConsumer` wraps handler — validate payload → idempotency check (Redis lock + marker) → call handler → Ack. Retryable errors: tiered-backoff via `app.retry` → if retries exhausted → DLQ (Nack no-requeue). Publish errors → Nack requeue.
- **Transactional outbox** (events tied to DB):
  - Service writes record + `OutboxRepository.enqueue(event)` within the same `TransactionManager.run(...)` (atomic, via `prisma.db` ALS context).
  - `OutboxRelay` (worker) polls outbox → `EventPublisherService.publish` → marks sent.
  - Standalone events (no DB atomicity needed) e.g. `notification.created` → publish directly.
- **Health**: `GET /health` returns field `rabbitmq: 'up' | 'down'`.
- **Env**: `RABBITMQ_EXCHANGE`, `RABBITMQ_PREFETCH`, `RABBITMQ_MAX_RETRIES`, `RABBITMQ_RETRY_DELAYS_MS`, `RABBITMQ_QUORUM_DELIVERY_LIMIT`, `RABBITMQ_IDEMPOTENCY_TTL`, `RABBITMQ_OUTBOX_POLL_MS`, `RABBITMQ_OUTBOX_BATCH_SIZE` (removed `RABBITMQ_QUEUE`).

### Worker process — BullMQ runs in a separate process/port
- **Two processes, one codebase, two entrypoints**: API (`src/main.ts`, `:PORT`) is purely a **producer** (only enqueues); Worker (`src/main.worker.ts`, `:WORKER_PORT` default 3001) runs `@Processor` + Bull Board. Goal: heavy jobs DO NOT block the API event loop.
- **WorkerModule** (`src/worker.module.ts`): loads — `CoreConfigModule`, `LoggerModule`, `RedisModule`, `PrismaModule`, `QueueModule`, `MessagingModule.forRoot({ consumer: true })`, `OutboxModule.withRelay()`, `BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter })` + the `<feature>-worker.module.ts` files (BullMQ processors) + `NotificationsConsumerModule`, `UsersConsumerModule`, `UnroutedConsumer`. Reuses `HealthController` (`:WORKER_PORT/health`). DO NOT register global `APP_*`. Worker NOW opens both DB (Prisma) and RMQ connections.
- **Features with background jobs → split producer/consumer**:
  - `<feature>.module.ts` (API side): keeps `registerQueue` + producer, **REMOVES** processor.
  - `<feature>-worker.module.ts` (worker side): `registerQueue` + `BullBoardModule.forFeature({ name, adapter: BullMQAdapter })` + `Processor`. Features that need DB have their worker module import `PrismaModule` themselves.
  - Reference module: `src/modules/mail/` (`mail.module.ts` + `mail-worker.module.ts`).
- **Concurrency**: set via `@Processor('<q>', { concurrency })`. Read from env using a PLAIN helper (e.g. `mailWorkerConcurrency()` reads `process.env.MAIL_WORKER_CONCURRENCY`, safe fallback) — DO NOT use ConfigService since it is not available at class decoration time.
- **Bull Board** `/admin/queues` (ONLY on worker): protected by **Fastify `onRequest` hook** in `main.worker.ts` (NOT Nest middleware — bull-board registers routes via an encapsulated Fastify plugin; hook attaches to `adapter.getInstance()` BEFORE `NestFactory.create`). Plain auth helper: `src/common/auth/basic-auth.ts`. Route hook MUST MATCH `BullBoardModule.forRoot({ route })` — see the global-prefix footgun warning in `main.worker.ts`.
- **Worker env** (in `env.schema.ts`, both processes validate the SAME schema): `WORKER_PORT` (3001), `MAIL_WORKER_CONCURRENCY` (5), `BULLBOARD_USER` (admin), `BULLBOARD_PASSWORD` (NO default — `superRefine` **requires** it in `production`; dev fallback `admin`).
- **Testing Bull Board UI in browser (Playwright/Chrome)**: authenticate via **headers** (`httpCredentials` / `setExtraHTTPHeaders({ Authorization: 'Basic <base64>' })`) and open a CLEAN URL (`http://localhost:3001/admin/queues`). **DO NOT** embed creds in URL (`http://admin:pass@localhost:3001/...`): the page + queue data (axios/XHR) will still work, BUT Bull Board's i18n uses `fetch()` to load `static/locales/{lng}/messages.json` — `fetch()` resolving relative to a document URL with embedded credentials gets blocked by the browser → UI shows **raw i18n keys** (`QUEUE.STATUS.ACTIVE`...). This is a test artifact, NOT a bug (real users use the Basic Auth dialog, creds stay outside the URL).

### Tests — separated in `test/`, NOT colocated
- Tests DO NOT live next to source files. The `test/` tree mirrors the `src/` structure:
  - **Unit**: `test/unit/<path-mirroring-src>/<name>.spec.ts`.
    - Example: source `src/modules/users/services/users.service.ts` → test `test/unit/modules/users/services/users.service.spec.ts`.
  - **E2E / integration**: `test/e2e/*.e2e-spec.ts`, run via `pnpm test:e2e` (separate config `jest.e2e.config.js`). Main `jest.config.js` (`.spec.ts$`) does NOT pick up `*.e2e-spec.ts` files.
  - DO NOT use `__tests__/`.
- **Imports in tests always use path aliases** (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`) — because tests live outside the module so relative paths are not used. (The "relative within the same module" convention above ONLY applies to source files in `src/`.)
- Configuration:
  - `jest.config.js`: `rootDir: '.'`, `roots: ['<rootDir>/test']`, alias `moduleNameMapper` pointing to `src/`.
  - `tsconfig.spec.json` (`include: ['src','test']`, `rootDir: '.'`) for typechecking tests — `pnpm typecheck` uses this file. Build (`tsconfig.build.json`) still excludes `test` + `*.spec.ts`.
- Mock **repository PORT** with plain object `useValue` — do not mock `PrismaService`.
- Call `jest.clearAllMocks()` in `beforeEach`.

---

## Slash commands (`.claude/commands/`)

| Command | Description |
|---|---|
| `/coding-convention` | Code conventions — view passively or scan and fix (`--fix`) |
| `/review-code` | Quality review against 11 criteria (includes architecture criteria) |
| `/create-module` | Generate a complete feature-first module (repository port + Prisma impl + nestjs-zod) |
| `/create-dto` | Generate Zod DTO: create / update / response / query |
| `/create-test` | Generate Jest spec in `test/unit/` (mirrors src), mock repository PORT |
| `/create-tdd` | Red-green-refactor workflow with guidance |
