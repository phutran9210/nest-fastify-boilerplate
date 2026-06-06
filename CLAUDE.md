# nest-fastify — CLAUDE.md

Tài liệu ngắn gọn cho Claude. Đọc kỹ trước khi sinh code.

---

## Stack

| Layer | Thư viện / Công cụ |
|---|---|
| Framework | NestJS 11 + Fastify (`@nestjs/platform-fastify`) |
| ORM | Prisma 7 — generator `prisma-client` (ESM), client tại `src/generated/prisma`, import từ `src/generated/prisma/client`, driver adapter `@prisma/adapter-pg` |
| Validation / Serialization | nestjs-zod + Zod 4 — global `ZodValidationPipe` + `ZodSerializerInterceptor` |
| Auth | passport-jwt, global `JwtAuthGuard` |
| Queue / Messaging | BullMQ (`@nestjs/bullmq`) chạy ở **worker process riêng** + Bull Board (`@bull-board/*`); RabbitMQ (`@golevelup/nestjs-rabbitmq`) — topology quorum + DLX + retry-tier + alternate-exchange; producer ở API, consumer + outbox relay ở **worker** |
| Ngày giờ | `@js-temporal/polyfill` (Temporal API) |
| Logging | Pino (`nestjs-pino`) — global `LoggerModule` tại `src/core/logger/`; `pino-pretty` chỉ ở dev, prod là JSON; thay logger Nest qua `app.useLogger` |
| Tooling | Biome (lint + format), Jest, pnpm |
| API Docs | Swagger UI tại `/docs` — xây bằng `cleanupOpenApiDoc` từ nestjs-zod |

---

## Lệnh chính (pnpm — KHÔNG dùng npm/yarn)

```bash
pnpm start:dev        # Khởi động API (producer) dev server
pnpm start:worker:dev # Khởi động Worker process (BullMQ + Bull Board) — watch
pnpm test             # Chạy toàn bộ Jest unit tests
pnpm test:e2e         # Chạy e2e (jest.e2e.config.js, test/e2e/*.e2e-spec.ts)
pnpm check            # Biome format + lint --write
pnpm lint             # Biome lint (không ghi)
pnpm prisma:migrate   # Chạy Prisma migrations
pnpm prisma:generate  # Sinh Prisma client
```

> Production worker: `pnpm start:worker:prod` (= `node dist/src/main.worker.js`). `nest build` biên dịch CẢ HAI entrypoint (`main`, `main.worker`).

---

## Convention cốt lõi

### `any` — DUOC PHEP (noExplicitAny off)
- Biome tắt `noExplicitAny` — dùng `any` khi cần.
- Response DTO được phép và thường xuyên dùng `z.any()`.
- `useImportType` cũng tắt — KHONG bat buoc `import type`.

### Auth opt-out — `@Public()` de mo endpoint
- Global `JwtAuthGuard` bao ve MOI route mac dinh.
- De lo route cong khai: gan decorator `@Public()` (tu `src/common/decorators/public.decorator.ts`).
- Controller can xac thuc: `ApiBearerAuth()` dat BEN TRONG composite decorator cua module (xem muc Swagger ben duoi), KHONG dat truc tiep tren controller.

### Logging — Pino (nestjs-pino)
- Logger toan cuc cau hinh tai `src/core/logger/logger.module.ts`; `main.ts` thay logger Nest qua `app.useLogger(app.get(Logger))` (Logger tu `nestjs-pino`) + `bufferLogs: true`.
- Trong service/controller: dung `Logger` cua `@nestjs/common` (da route qua Pino) hoac inject `PinoLogger` tu `nestjs-pino`. **KHONG dung `console.log`.**
- Request log tu dong qua pino-http — KHONG tu viet interceptor log request.
- Level: `LOG_LEVEL` env (mac dinh `debug` o dev, `info` o prod).
- **Redact du lieu nhay cam**: danh sach path tai `src/core/logger/log-redact.ts` (`authorization`, `cookie`, `password`, `token`, `secret`… ca top-level lan `*.x`). Them field nhay cam moi vao file nay.
- **Ghi log ra file (tuy chon)**: `LOG_FILE_ENABLED=true` → file tong `app.<date>.N.log` trong `LOG_DIR` (mac dinh `logs/`). Xoay khi **sang ngay moi HOAC file vuot `LOG_FILE_MAX_SIZE`** (mac dinh `50m`); giu `LOG_FILE_MAX_DAYS` file gan nhat (mac dinh 30) qua `pino-roll`. Console van log song song.
- **File loi rieng (tuy chon)**: `LOG_ERROR_FILE_ENABLED=true` → them `error.<date>.N.log` CHI chua level≥error (loi van vao ca file tong → giu tuong quan).
- **Script loc log** (jq + pino-pretty): `pnpm logs` (xem dep), `pnpm logs:tail` (live), `pnpm logs:err` (chi loi), `pnpm logs:warn` (warn+), `pnpm logs:errfile` (xem file loi rieng).
- `req.id` trong log == header `x-request-id` tra ve client (cung nguon tu Fastify `genReqId`).

### Swagger — gom tap trung trong `decorators/`
- MOI controller co file `<module>/decorators/<feature>-api.decorator.ts` chua toan bo metadata Swagger duoi dang composite `applyDecorators`.
- Class-level: `Api<Feature>Controller()` — gom `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` neu can auth).
- Per-endpoint: `Api<Action>()` — gom `ApiEnvelopeResponse(...)` va metadata rieng cua route.
- Controller **KHONG** import truc tiep tu `@nestjs/swagger` — chi import cac `Api*()` tu `decorators/`.
- Ap dung cho MOI controller, ke ca route chi co `ApiTags` (mail, notifications, health…).
- Module tham chieu: `src/modules/users/decorators/users-api.decorator.ts`.

### HTTP status — `@HttpCode` tuong minh, dung `HttpStatus` cua `@nestjs/common`
- MOI route HTTP **bat buoc** khai bao `@HttpCode(HttpStatus.X)` tuong minh — KHONG dua vao mac dinh ngam cua Nest (POST→201, con lai→200).
- `status` trong `ApiEnvelopeResponse(..., { status: HttpStatus.X })` phai dung **cung** `HttpStatus.X` voi `@HttpCode` → runtime va Swagger luon dong bo.
- KHONG dung so magic (`201`, `202`…) — luon dung enum `HttpStatus` (`CREATED`, `OK`, `ACCEPTED`, `NO_CONTENT`…).
- Quy uoc status: tao resource → `CREATED` (201); doc/sua/xoa tra body → `OK` (200); hanh dong bat dong bo (enqueue/publish) → `ACCEPTED` (202).

### Date trong response DTO — KHONG dung `z.date()`
- `z.date()` lam `z.toJSONSchema()` (nestjs-zod dung cho Swagger) bi crash — **app khong boot**.
- Thay the bang:
  ```ts
  z.any().transform((v) => v instanceof Date ? v.toISOString() : String(v))
  ```
- Day la pattern bat buoc cho moi field kieu Date trong response DTO.

### Logic ngay thang dung Temporal
- Import: `import { Temporal, toTemporalInstant } from '@js-temporal/polyfill'`
- Chuyen Prisma `Date` sang Temporal: `toTemporalInstant.call(date)` (KHONG phai `date.toTemporalInstant()`).
- Tranh dung `new Date()` cho logic nghiep vu.

### Cau truc du an — feature-first, co phan tang ro rang

```
src/
├── main.ts          # entrypoint API (producer, :PORT)
├── main.worker.ts   # entrypoint Worker (BullMQ + Bull Board + RMQ consumer, :WORKER_PORT)
├── app.module.ts    # root module API
├── worker.module.ts # root module Worker (Redis + Prisma + RMQ consumer + Outbox relay)
├── common/          # cross-cutting concerns
│   ├── auth/        # basic-auth.ts (verifyBasicAuth + Fastify hook cho Bull Board)
│   ├── decorators/  # @Public(), v.v.
│   ├── filters/     # HttpExceptionFilter
│   ├── guards/      # JwtAuthGuard
│   └── interceptors/
├── core/            # infrastructure (khong co business logic)
│   ├── config/      # Zod-validated env
│   ├── prisma/      # PrismaService (@Global)
│   ├── queue/       # BullMQ root
│   ├── messaging/   # RabbitMQ client
│   ├── redis/        # RedisModule @Global: Cache/Lock/RateLimit/PubSub (ioredis + port pattern)
│   └── health/      # GET /health (reuse o ca API lan Worker)
└── modules/         # business features
    ├── users/
    │   ├── users.module.ts
    │   ├── controllers/
    │   ├── decorators/    # Swagger gom tap trung — composite @Api*()
    │   ├── services/      # *.service.ts (test o test/unit/, KHONG colocated)
    │   ├── repositories/  # *.repository.port.ts (PORT) + *.repository.prisma.ts (IMPL)
    │   └── dto/
    ├── auth/
    ├── mail/                 # mail.module.ts (producer) + mail-worker.module.ts (processor)
    │   └── jobs/             # mail.producer.ts, mail.processor.ts
    └── notifications/     # RabbitMQ consumer (NotificationsConsumerModule)
```

- **Path alias cho import vuot cap (khac module/layer)** — khai bao o `tsconfig.json` (`paths`), `.swcrc` (`jsc.baseUrl` + `jsc.paths`) va `jest.config.js` (`moduleNameMapper`):
  - `@common/*` → `src/common/*`
  - `@core/*` → `src/core/*`
  - `@modules/*` → `src/modules/*`
  - `@generated/*` → `src/generated/*`
  - Dung alias khi import vuot ra ngoai module/layer hien tai (truoc day la `../../../`). Vi du: `@common/decorators/public.decorator`, `@modules/users/dto/user-response.dto`, `@generated/prisma/client`.
  - **Import trong cung module** (cung folder `<feature>/`) van dung relative ngan (`./`, `../dto/`, `../services/`) — KHONG alias hoa.
  - SWC rewrite alias → relative luc build (xem `dist/`), nen runtime khong can `tsconfig-paths`.
- Khong tao file barrel `index.ts`.
- Module file (`<feature>.module.ts`) nam thang trong `src/modules/<feature>/`.

### Repository port pattern — data access

- **Service inject PORT** (`abstract class <Feature>Repository`) — KHONG inject `PrismaService` truc tiep.
- **Naming theo vai tro (suffix):** PORT = `<feature>.repository.port.ts`, IMPL = `<feature>.repository.prisma.ts` — nhin duoi file la biet vai tro. Doi adapter khac → `<feature>.repository.<adapter>.ts` (vd `.mongo.ts`).
- **PORT** (`repositories/<feature>.repository.port.ts`): `abstract class` dong vai tro TS type VA DI token; re-export model type qua `export type { <Model> }`; dinh nghia `Create<F>Data` / `Update<F>Data`.
- **Prisma impl** (`repositories/<feature>.repository.prisma.ts`): file DUY NHAT import `PrismaService` va `generated/prisma`.
- **Module wiring**: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`.
- Service import kieu model TU PORT, khong import tu `generated/prisma` truc tiep.

Xem `src/modules/users/` la module tham chieu chinh xac nhat.

### Redis — inject PORT, không inject REDIS_CLIENT trực tiếp trong module nghiệp vụ
- Module nghiệp vụ chỉ inject port: `CacheService`, `LockService`, `RateLimitService`, `PubSubService`.
- KHÔNG inject `REDIS_CLIENT` / `REDIS_SUBSCRIBER` symbol trực tiếp bên ngoài `src/core/redis/` (ngoại trừ `HealthController`).
- Lock và RateLimit chạy atomic qua Lua script — không dùng get+set thường.
- PubSub (ioredis) không thay thế RabbitMQ cho việc cần durable/fanout cross-service.
- `buildRedisBaseOptions` được dùng chung cho BullMQ (KHÔNG thêm `keyPrefix` vào BullMQ — nó có cơ chế prefix riêng).

### RabbitMQ / Messaging — `@golevelup/nestjs-rabbitmq`

- **MessagingModule** (`src/core/messaging/`): `MessagingModule.forRoot({ consumer })` — API nạp với `consumer: false` (producer-only, `registerHandlers: false`); Worker nạp với `consumer: true` (đăng ký handler + topology assert).
- **Exchanges** (tên suy từ env `RABBITMQ_EXCHANGE`, mặc định `app`):
  - `app.events` (topic) — exchange chính, có `alternate-exchange: app.unrouted`.
  - `app.retry` (topic) — retry-tier queues bind vào đây.
  - `app.dlx` (topic) — dead-letter exchange; message hết retry vào DLQ.
- **Topology tập trung** tại `src/core/messaging/topology.ts` — assert toàn bộ queues/exchanges khi worker khởi động. Consumer dùng `@RabbitSubscribe({ createQueueIfNotExists: false })` (KHÔNG để golevelup tự tạo queue).
- **Per-subscription queue**: `<subscriber>.<event>.q` (quorum) + retry-tier queues (durable, TTL tăng dần) + `<subscriber>.<event>.dlq` (quorum).
- **Contract Zod** tại `src/core/messaging/messaging.contracts.ts`: object `EventContracts` map `routingKey → Zod schema`; `SUBSCRIPTIONS` list. Thêm event mới = thêm 1 entry vào `EventContracts` + 1 entry vào `SUBSCRIPTIONS` + handler.
- **Publish**: `EventPublisherService.publish(routingKey, payload, opts?)` — validate payload qua contract trước khi gửi. Dùng ở API và worker.
- **Consume**: `MessageConsumer` bọc handler — validate payload → idempotency check (Redis lock + marker) → gọi handler → Ack. Lỗi có thể retry: tiered-backoff qua `app.retry` → nếu hết lượt → DLQ (Nack no-requeue). Lỗi publish → Nack requeue.
- **Transactional outbox** (event gắn DB):
  - Service ghi record + `OutboxRepository.enqueue(event)` trong cùng `TransactionManager.run(...)` (atomic, qua `prisma.db` ALS context).
  - `OutboxRelay` (worker) poll outbox → `EventPublisherService.publish` → mark sent.
  - Event rời (không cần atomicity với DB) vd `notification.created` → publish trực tiếp.
- **Health**: `GET /health` trả field `rabbitmq: 'up' | 'down'`.
- **Env**: `RABBITMQ_EXCHANGE`, `RABBITMQ_PREFETCH`, `RABBITMQ_MAX_RETRIES`, `RABBITMQ_RETRY_DELAYS_MS`, `RABBITMQ_QUORUM_DELIVERY_LIMIT`, `RABBITMQ_IDEMPOTENCY_TTL`, `RABBITMQ_OUTBOX_POLL_MS`, `RABBITMQ_OUTBOX_BATCH_SIZE` (đã bỏ `RABBITMQ_QUEUE`).

### Worker process — BullMQ chạy process/cổng độc lập
- **Hai process, một codebase, hai entrypoint**: API (`src/main.ts`, `:PORT`) thuần **producer** (chỉ enqueue); Worker (`src/main.worker.ts`, `:WORKER_PORT` mặc định 3001) chạy `@Processor` + Bull Board. Mục tiêu: job nặng KHÔNG chiếm event loop của API.
- **WorkerModule** (`src/worker.module.ts`): nạp — `CoreConfigModule`, `LoggerModule`, `RedisModule`, `PrismaModule`, `QueueModule`, `MessagingModule.forRoot({ consumer: true })`, `OutboxModule.withRelay()`, `BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter })` + các `<feature>-worker.module.ts` (BullMQ processor) + `NotificationsConsumerModule`, `UsersConsumerModule`, `UnroutedConsumer`. Reuse `HealthController` (`:WORKER_PORT/health`). KHÔNG đăng ký global `APP_*`. Worker NAY mở cả DB (Prisma) và RMQ connection.
- **Feature có background job → tách producer/consumer**:
  - `<feature>.module.ts` (phía API): giữ `registerQueue` + producer, **BỎ** processor.
  - `<feature>-worker.module.ts` (phía worker): `registerQueue` + `BullBoardModule.forFeature({ name, adapter: BullMQAdapter })` + `Processor`. Feature nào cần DB thì module worker NÀY tự import `PrismaModule`.
  - Module tham chiếu: `src/modules/mail/` (`mail.module.ts` + `mail-worker.module.ts`).
- **Concurrency**: đặt qua `@Processor('<q>', { concurrency })`. Đọc từ env bằng helper THUẦN (vd `mailWorkerConcurrency()` đọc `process.env.MAIL_WORKER_CONCURRENCY`, fallback an toàn) — KHÔNG dùng ConfigService vì chưa khả dụng lúc decorate class.
- **Bull Board** `/admin/queues` (CHỈ trên worker): bảo vệ bằng **Fastify `onRequest` hook** trong `main.worker.ts` (KHÔNG phải Nest middleware — bull-board đăng ký route qua plugin Fastify đóng gói; hook gắn vào `adapter.getInstance()` TRƯỚC `NestFactory.create`). Helper auth thuần: `src/common/auth/basic-auth.ts`. Route hook phải KHỚP `BullBoardModule.forRoot({ route })` — xem cảnh báo footgun global-prefix trong `main.worker.ts`.
- **Env worker** (trong `env.schema.ts`, cả 2 process validate CHUNG schema): `WORKER_PORT` (3001), `MAIL_WORKER_CONCURRENCY` (5), `BULLBOARD_USER` (admin), `BULLBOARD_PASSWORD` (KHÔNG default — `superRefine` **bắt buộc** ở `production`; dev fallback `admin`).
- **Test Bull Board UI bằng trình duyệt (Playwright/Chrome)**: xác thực bằng **header** (`httpCredentials` / `setExtraHTTPHeaders({ Authorization: 'Basic <base64>' })`) và mở URL SẠCH (`http://localhost:3001/admin/queues`). **KHÔNG** nhúng creds vào URL (`http://admin:pass@localhost:3001/...`): trang + dữ liệu queue (axios/XHR) vẫn chạy, NHƯNG i18n của Bull Board dùng `fetch()` tải `static/locales/{lng}/messages.json` — `fetch()` tương đối resolve trên document URL có credentials sẽ bị trình duyệt cấm → UI hiện **key i18n thô** (`QUEUE.STATUS.ACTIVE`…). Đây là artifact của test, KHÔNG phải lỗi (user thật dùng hộp Basic Auth, creds nằm ngoài URL).

### Tests — tach rieng trong `test/`, KHONG colocated
- Test KHONG nam canh source nua. Cay `test/` phan chieu cau truc `src/`:
  - **Unit**: `test/unit/<duong-dan-mirror-src>/<ten>.spec.ts`.
    - Vi du: source `src/modules/users/services/users.service.ts` → test `test/unit/modules/users/services/users.service.spec.ts`.
  - **E2E / integration**: `test/e2e/*.e2e-spec.ts`, chay qua `pnpm test:e2e` (config rieng `jest.e2e.config.js`). Main `jest.config.js` (`.spec.ts$`) KHONG nhat file `*.e2e-spec.ts`.
  - KHONG dung `__tests__/`.
- **Import source trong test luon dung path alias** (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`) — vi test nam ngoai module nen khong dung relative. (Quy uoc "relative trong cung module" o tren CHI ap dung cho file source trong `src/`.)
- Cau hinh:
  - `jest.config.js`: `rootDir: '.'`, `roots: ['<rootDir>/test']`, alias `moduleNameMapper` tro vao `src/`.
  - `tsconfig.spec.json` (`include: ['src','test']`, `rootDir: '.'`) cho typecheck test — `pnpm typecheck` chay file nay. Build (`tsconfig.build.json`) van loai `test` + `*.spec.ts`.
- Mock **repository PORT** bang plain object `useValue` — khong mock `PrismaService`.
- Goi `jest.clearAllMocks()` trong `beforeEach`.

---

## Slash commands (`.claude/commands/`)

| Command | Mo ta |
|---|---|
| `/coding-convention` | Quy uoc code — xem thu dong (passive) hoac quet va sua (`--fix`) |
| `/review-code` | Review chat luong theo 11 tieu chi (co tieu chi kien truc) |
| `/create-module` | Sinh feature module feature-first day du (repository port + Prisma impl + nestjs-zod) |
| `/create-dto` | Sinh Zod DTO: create / update / response / query |
| `/create-test` | Sinh Jest spec trong `test/unit/` (mirror src), mock repository PORT |
| `/create-tdd` | Workflow red-green-refactor co huong dan |
