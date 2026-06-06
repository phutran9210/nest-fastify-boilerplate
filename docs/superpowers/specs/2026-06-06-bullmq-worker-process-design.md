# BullMQ Worker — process độc lập, cổng riêng

**Ngày:** 2026-06-06
**Trạng thái:** Đã duyệt thiết kế, chờ review spec

---

## 1. Vấn đề

Hiện tại `MailProcessor` (BullMQ `WorkerHost`) được khai báo trong `MailModule` → **worker chạy ngay trong process API**. Mọi job nặng tiêu thụ event loop chung với HTTP, ảnh hưởng độ trễ/throughput của API.

Mục tiêu: tách worker BullMQ ra **process riêng, cổng HTTP riêng**, để xử lý job không ảnh hưởng API. API trở thành **thuần producer** (chỉ enqueue).

## 2. Quyết định đã chốt

| Quyết định | Lựa chọn |
|---|---|
| Hình dạng worker | Nest **Fastify app riêng**, listen `WORKER_PORT` (mặc định 3001), expose `/health` + Bull Board UI |
| Vai trò API | **Thuần producer** — giữ `MailProducer` + `registerQueue('mail')`, **bỏ** `MailProcessor` |
| Bảo vệ Bull Board | **Basic Auth** qua env (`fastify-basic-auth`) |
| Quy mô | **Pattern tổng quát** `<feature>-worker.module.ts`, migrate queue `mail` làm mẫu |

## 3. Kiến trúc

Hai process, **một codebase**, hai entrypoint:

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│  API process (main.ts)      │ enqueue│  Worker process              │
│  AppModule — Fastify :3000  │───────▶│  (main.worker.ts)            │
│  MailProducer               │ (Redis)│  WorkerModule — Fastify :3001│
│  registerQueue('mail')      │        │  MailProcessor (WorkerHost)  │
│  KHÔNG có Processor         │        │  GET /health                 │
│                             │        │  /admin/queues (Bull Board)  │
└─────────────────────────────┘        └──────────────────────────────┘
```

- Cùng codebase → `nest build` (builder swc) biên dịch **cả hai** entrypoint; chọn entry khi chạy bằng `--entryFile`.
- API không còn chạy job nặng → event loop HTTP không bị block.
- Cổng worker (:3001) **chỉ** phục vụ health probe + Bull Board, không nhận traffic nghiệp vụ.
- Worker **không** kết nối RabbitMQ microservice (`NotificationsModule` ở lại API — ngoài phạm vi).

## 4. Thay đổi chi tiết

### 4.1 File mới

**`src/main.worker.ts`** — bootstrap worker:
- `NestFactory.create<NestFastifyApplication>(WorkerModule, new FastifyAdapter(), { bufferLogs: true })`.
- `app.useLogger(app.get(Logger))` (Pino, như `main.ts`).
- `app.enableShutdownHooks()`.
- `await app.listen(WORKER_PORT, '0.0.0.0')`; log `Worker on :<port> | Bull Board at /admin/queues`.
- `bootstrap().catch(...)` fallback `console.error` + `process.exit(1)` (như `main.ts`).
- **Không** `connectMicroservice`/RMQ, **không** Swagger.

**`src/worker.module.ts`** — root module worker process:
- `imports`:
  - Infra dùng chung: `CoreConfigModule`, `LoggerModule`, `PrismaModule`, `RedisModule`, `QueueModule` (BullMQ `forRoot` global).
  - `BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter, middleware: <basic-auth> })` từ `@bull-board/nestjs` + `@bull-board/fastify`.
  - Feature worker modules: `MailWorkerModule` (và các module tương lai).
- `controllers: [HealthController]` — **tái dùng** controller health sẵn có (`src/core/health/health.controller.ts`, ping Redis qua `REDIS_CLIENT`). Không tạo file health mới.
- **Không** đăng ký các global `APP_*` provider của API (guard/pipe/interceptor/filter) — worker không có route nghiệp vụ; chỉ health (`@Public`) + Bull Board. Giữ tối giản.

> Middleware Basic Auth (Fastify): theo doc `@bull-board/nestjs`, dùng `fastify-basic-auth` bọc trong hàm `middleware: (req, res, next) => fastifyBasicAuth({ validate })(req, res, next)`, `validate` so khớp `BULLBOARD_USER`/`BULLBOARD_PASSWORD` từ env (đọc qua `process.env` hoặc factory — xác định ở bước plan).

**`src/modules/mail/mail-worker.module.ts`** — phía worker của feature mail:
- `imports`:
  - `BullModule.registerQueue({ name: 'mail' })` — cần để Bull Board `forFeature` introspect được Queue instance.
  - `BullBoardModule.forFeature({ name: 'mail', adapter: BullMQAdapter })` từ `@bull-board/api/bullMQAdapter`.
- `providers: [MailProcessor]`.

### 4.2 File sửa

**`src/modules/mail/mail.module.ts`** — bỏ `MailProcessor` khỏi `providers` và import. Giữ `registerQueue('mail')`, `MailController`, `MailProducer`, `exports: [MailProducer]`. API thành thuần producer.

**`src/modules/mail/jobs/mail.processor.ts`** — thêm concurrency:
```ts
@Processor('mail', { concurrency: Number(process.env.MAIL_WORKER_CONCURRENCY ?? 5) })
```
> **Ngoại lệ có chủ đích:** đọc `process.env` trực tiếp vì `ConfigService` chưa khả dụng tại thời điểm decorate class. Ghi comment giải thích ngay trên decorator.

**`src/core/config/env.schema.ts`** — thêm:
```ts
WORKER_PORT: z.coerce.number().int().positive().default(3001),
MAIL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
BULLBOARD_USER: z.string().default('admin'),
BULLBOARD_PASSWORD: z.string().default('admin'),
```
> `BULLBOARD_PASSWORD` mặc định `'admin'` cho tiện dev — **phải đặt giá trị mạnh ở prod** (ghi chú trong `.env.example` nếu có).

**`package.json` scripts**:
```jsonc
"start:worker": "nest start --entryFile main.worker",
"start:worker:dev": "nest start --watch --entryFile main.worker",
"start:worker:prod": "node dist/src/main.worker.js"
```

**Dependencies mới** (`dependencies`):
`@bull-board/nestjs`, `@bull-board/api`, `@bull-board/fastify`, `fastify-basic-auth`.

### 4.3 Không đổi

- `docker-compose.yml` chỉ chứa hạ tầng (postgres/redis/rabbitmq), **không có service app** → không thêm service `worker`. Worker chạy như process riêng qua pnpm script ở môi trường dev. (Khi container hóa app sau này mới thêm service worker — ngoài phạm vi.)
- `QueueModule`, `buildRedisBaseOptions`, kết nối Redis dùng chung — giữ nguyên (BullMQ tự quản connection riêng, không thêm `keyPrefix`).

## 5. Data flow

1. API nhận request → `MailProducer.enqueue()` → `queue.add('send', data, opts)` ghi job vào Redis.
2. Worker process (subscribe queue `mail` qua `MailProcessor`) lấy job từ Redis, chạy `process()` với concurrency cấu hình.
3. Kết quả/lỗi/retry (`attempts: 3`, backoff exponential) do BullMQ quản lý trong Redis; xem được qua Bull Board `:3001/admin/queues`.

## 6. Xử lý lỗi & vận hành

- **Retry/backoff**: giữ nguyên option ở producer (`attempts`, `backoff`, `removeOnComplete`).
- **Shutdown**: `enableShutdownHooks()` → `WorkerHost` đóng worker, drain job đang chạy khi nhận SIGTERM/SIGINT.
- **Health**: `:3001/health` ping Redis (timeout 500ms, trả `down` thay vì treo) — dùng cho liveness probe.
- **Bull Board**: 401 nếu thiếu Basic Auth; hiển thị waiting/active/completed/failed + payload job.
- **Cô lập lỗi**: worker crash không làm sập API và ngược lại (process tách biệt).

## 7. Testing

- **Unit** (`test/unit/`, mirror src, alias import, mock PORT — theo convention):
  - Thêm `test/unit/modules/mail/jobs/mail.processor.spec.ts` (hiện chưa có): `process()` trả `{ delivered: true }`, log đúng (mock Logger).
  - Thêm `test/unit/modules/mail/jobs/mail.producer.spec.ts` (hiện chưa có): `enqueue()` gọi `queue.add('send', data, opts)` đúng tham số (mock `Queue`).
- **E2E** (tùy chọn, đặt dần): không bắt buộc trong scope này.
- **Smoke thủ công**: chạy `pnpm start:worker:dev`, enqueue qua API, xác nhận job chạy ở worker + hiện trên Bull Board.
- `pnpm verify` (i18n:gen + check + typecheck + build) phải pass — đặc biệt **build phải biên dịch được `main.worker.ts`**.

## 8. Phạm vi loại trừ (YAGNI)

- Không container hóa app/worker trong compose ở scope này.
- Không thêm metrics/Prometheus ở cổng worker (chỉ health + Bull Board).
- Không migrate RabbitMQ `NotificationsModule` (khác cơ chế, ở lại API).
- Không tạo thêm queue mới — chỉ thiết lập pattern + migrate `mail`.

## 9. Tiêu chí hoàn thành

- [ ] `pnpm start:dev` (API) chạy, **không** còn khởi tạo `MailProcessor`.
- [ ] `pnpm start:worker:dev` chạy app riêng ở :3001, log Bull Board route.
- [ ] Enqueue job qua API → worker xử lý (log ở process worker, không ở API).
- [ ] `:3001/health` trả `{ status: ok, redis: up }`.
- [ ] `:3001/admin/queues` đòi Basic Auth, hiển thị queue `mail`.
- [ ] `pnpm verify` pass (build cả 2 entrypoint).
