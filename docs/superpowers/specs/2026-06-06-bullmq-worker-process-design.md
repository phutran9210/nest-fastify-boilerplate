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
| Bảo vệ Bull Board | **Basic Auth** qua env, áp bằng **Fastify `onRequest` hook** + helper tự viết (KHÔNG dùng `fastify-basic-auth`/Nest middleware — xem §4.1 lý do) |
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
- **Đăng ký Fastify `onRequest` hook bảo vệ Bull Board** (xem dưới) — đặt **trước** `app.listen()`.
- `app.enableShutdownHooks()`.
- `await app.listen(WORKER_PORT, '0.0.0.0')`; log `Worker on :<port> | Bull Board at /admin/queues`.
- `bootstrap().catch(...)` fallback `console.error` + `process.exit(1)` (như `main.ts`).
- **Không** `connectMicroservice`/RMQ, **không** Swagger.

**`src/worker.module.ts`** — root module worker process:
- `imports`:
  - Infra cần cho worker: `CoreConfigModule`, `LoggerModule`, `RedisModule`, `QueueModule` (BullMQ `forRoot` global).
  - **KHÔNG** import `PrismaModule` ở đây (xem §4.3, finding "Redis-only"). Feature worker module nào cần DB sẽ tự import `PrismaModule`.
  - `BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter })` từ `@bull-board/nestjs` + `@bull-board/fastify`. **KHÔNG** truyền option `middleware` — theo doc `@bull-board/nestjs`, `middleware` chỉ áp cho **Express adapter**; auth làm bằng Fastify hook bên dưới.
  - Feature worker modules: `MailWorkerModule` (và các module tương lai).
- `controllers: [HealthController]` — **tái dùng** controller health sẵn có (`src/core/health/health.controller.ts`, ping Redis qua `REDIS_CLIENT`). Không tạo file health mới.
- **Không** `implements NestModule` / `configure()` — auth không qua Nest middleware (xem lý do dưới).
- **Không** đăng ký các global `APP_*` provider của API (guard/pipe/interceptor/filter) — worker không có route nghiệp vụ; chỉ health (`@Public`) + Bull Board. Giữ tối giản.

**`src/common/auth/basic-auth.ts`** — helper thuần (dễ unit test), KHÔNG phụ thuộc framework:
- `verifyBasicAuth(authHeader: string | undefined, expectedUser: string, expectedPass: string): boolean` — parse `Authorization: Basic <base64>`, so khớp user/pass (so sánh hằng-thời-gian nếu tiện).

**Auth Bull Board = Fastify `onRequest` hook** (trong `main.worker.ts`):
```ts
const fastify = app.getHttpAdapter().getInstance();
const cfg = app.get(ConfigService);
const user = cfg.get('BULLBOARD_USER') ?? 'admin';
const pass = cfg.get('BULLBOARD_PASSWORD') ?? 'admin'; // prod đã được schema ép có giá trị
fastify.addHook('onRequest', (req, reply, done) => {
  if (!req.url.startsWith('/admin/queues')) return done();
  if (verifyBasicAuth(req.headers.authorization, user, pass)) return done();
  reply.header('WWW-Authenticate', 'Basic realm="Bull Board"').code(401).send();
});
```
> **Vì sao hook chứ không phải Nest middleware:** Bull Board (Fastify adapter) đăng ký route qua **plugin Fastify đóng gói**; `@bull-board/nestjs` chỉ hỗ trợ option `middleware` cho Express. Fastify `onRequest` hook đăng ký ở **root instance** chắc chắn chạy cho **mọi** request kể cả route do plugin con tạo (theo mô hình encapsulation: hook của parent lan xuống child). Đây là cơ chế đáng tin cậy, không phụ thuộc việc Nest middleware có chặn được plugin route hay không. (E2e §7 vẫn assert 401/200 để chốt.)

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
> Đối số thứ 2 của `@Processor` (@nestjs/bullmq) là `WorkerOptions` của BullMQ — `concurrency` hợp lệ. Lưu ý: `concurrency` chỉ **không** có tác dụng khi khai báo **nhiều consumer cho cùng 1 queue**; ở đây mỗi queue đúng 1 consumer nên không vướng.

**`src/core/config/env.schema.ts`** — thêm các field, và một `.superRefine` ở cấp object để **bắt buộc `BULLBOARD_PASSWORD` khi `NODE_ENV === 'production'`** (không để default lọt vào prod):
```ts
WORKER_PORT: z.coerce.number().int().positive().default(3001),
MAIL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
BULLBOARD_USER: z.string().default('admin'),
// KHÔNG default — tránh credential mặc định lọt vào prod (worker bind 0.0.0.0).
BULLBOARD_PASSWORD: z.string().optional(),
```
```ts
// sau z.object({...}):
.superRefine((env, ctx) => {
  if (env.NODE_ENV === 'production' && !env.BULLBOARD_PASSWORD) {
    ctx.addIssue({ code: 'custom', path: ['BULLBOARD_PASSWORD'],
      message: 'BULLBOARD_PASSWORD là bắt buộc ở production (Bull Board lộ payload job).' });
  }
});
```
> Dev: `BULLBOARD_PASSWORD` không set → hook auth coi như `'admin'` (chỉ khi **không** phải production). Prod: schema fail-fast nếu thiếu → app worker không boot với credential mặc định. (Lưu ý: `.superRefine` đổi kiểu trả về của schema — kiểm tra `validateEnv` / `z.infer` vẫn đúng ở bước impl.)

**`package.json` scripts**:
```jsonc
"start:worker": "nest start --entryFile main.worker",
"start:worker:dev": "nest start --watch --entryFile main.worker",
"start:worker:prod": "node dist/src/main.worker.js"
```

**Dependencies mới** (`dependencies`):
`@bull-board/nestjs`, `@bull-board/api`, `@bull-board/fastify`. **Không** thêm `fastify-basic-auth` (auth tự viết).

### 4.3 Worker Redis-only + env dùng chung (tradeoff đã chấp nhận)

- **Worker không mở kết nối DB**: `WorkerModule` **không** import `PrismaModule` (PrismaService connect onModuleInit). `MailProcessor` hiện chỉ log → không cần DB. Pattern: `<feature>-worker.module.ts` **tự** import `PrismaModule` khi processor của nó cần DB → giữ worker tối thiểu, không ép `DATABASE_URL` cho mọi worker.
- **Env dùng chung (chấp nhận có chủ đích)**: cả 2 process validate **cùng** `env.schema.ts`, nên process worker vẫn yêu cầu `RABBITMQ_URL` và `JWT_SECRET` dù không dùng. Lý do giữ nguyên: worker chạy chung file `.env` với API ở dev/prod → các biến này luôn có sẵn; tách validation theo process là phức tạp hóa không tương xứng (out of scope). Nếu sau này worker deploy với secret tối thiểu, mới tách `env.schema` theo process.

### 4.4 Không đổi

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
  - Thêm `test/unit/common/auth/basic-auth.spec.ts`: `verifyBasicAuth` — thiếu/sai format header → `false`; sai creds → `false`; đúng creds → `true`.
- **E2E — bắt buộc trong scope này** (điểm tích hợp rủi ro nhất): `test/e2e/worker-bull-board.e2e-spec.ts` bootstrap `WorkerModule` (Fastify) và assert:
  - `GET /admin/queues` **không** kèm credentials → **401**.
  - `GET /admin/queues` kèm Basic Auth đúng → **200** (hoặc redirect tới UI, chấp nhận 2xx/3xx của Bull Board).
  Đây cũng là chỗ kiểm chứng Fastify `onRequest` hook thực sự chặn được route Bull Board (do plugin tạo).
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
- [ ] `:3001/admin/queues` không kèm credentials → 401; kèm Basic Auth đúng → vào được, hiển thị queue `mail`.
- [ ] Worker **không** mở kết nối DB (không import `PrismaModule`).
- [ ] `NODE_ENV=production` mà thiếu `BULLBOARD_PASSWORD` → worker fail-fast lúc validate env.
- [ ] e2e `worker-bull-board.e2e-spec.ts` (401/200) pass.
- [ ] `pnpm verify` pass (build cả 2 entrypoint).
