# Thiết kế: Nền tảng RabbitMQ chuẩn production

- **Ngày:** 2026-06-06
- **Trạng thái:** Đã duyệt design + áp review (chờ review lại spec)
- **Phạm vi:** Xây lớp messaging hạ tầng tái dùng trên RabbitMQ cho toàn dự án `nest-fastify`. Thay thế setup demo (`@nestjs/microservices` RMQ transport, 1 queue, không DLQ/retry). Bổ sung **transactional outbox** và 1 event nghiệp vụ thật `user.registered → gửi mail` làm tham chiếu.

---

## 1. Bối cảnh & hiện trạng

RabbitMQ đang ở mức demo:

- `@nestjs/microservices` + `Transport.RMQ`. 1 queue `notifications_queue` (`durable`), **không** exchange tùy biến, **không** DLX/DLQ, **không** retry/backoff, **không** manual ack/prefetch, **không** idempotency.
- Producer: `ClientProxy` (`RMQ_CLIENT`) → `.emit('notification.created', ...)`.
- Consumer: `@EventPattern` chạy **trong API process** (`connectMicroservice` + `startAllMicroservices` ở `main.ts`).

Mục tiêu: nâng lên **nền tảng messaging tái dùng** chuẩn production.

## 2. Quyết định kiến trúc (đã chốt)

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Thư viện | **`@golevelup/nestjs-rabbitmq`** (thay `@nestjs/microservices` RMQ) | Toàn quyền topology (exchange/binding/DLX/quorum/alternate-exchange), `@RabbitSubscribe` + `Nack`, prefetch/channel, **publisher confirms**, connection resilience. |
| Vị trí consumer + relay | **Worker process** | Background work gom 1 process; API giữ event-loop sạch. |
| Loại queue | **Quorum** cho work queue + DLQ; **durable classic** cho retry-tier queue | Quorum bền/HA + `x-delivery-limit` chống poison; retry queue chỉ là buffer TTL → classic durable đủ & nhẹ. |
| Retry | **Tiered backoff** (5s/30s/5m, configurable) | Version-agnostic; `x-delivery-limit` là backstop crash-loop độc lập. |
| Đảm bảo DB→event | **Transactional outbox đầy đủ** | Ghi event cùng transaction nghiệp vụ → relay publish ra RMQ. At-least-once DB→broker, không mất event khi crash/publish fail. |
| Mô hình queue | **Per-subscription queue** (`<subscriber>.<event>.q`) | Mỗi subscriber nhận 1 bản sao (fanout), không competing consumers. |
| Routing không khớp | **Alternate-exchange** `app.unrouted` + `mandatory: true` | Không drop âm thầm message chưa có binding. |

**Yêu cầu hạ tầng:** RabbitMQ **≥ 3.8** (quorum queues).

## 3. Kiến trúc tổng quan

```
API process (main.ts)                    Worker process (main.worker.ts)
  Direct publish (event rời, vd          OutboxRelay (poll DB → publish, confirms)
    notification.created)                RMQ consumers (@RabbitSubscribe)
  AuthService.register:                    validate → idempotency → handle
    tx{ users.create + outbox.enqueue }    retry/DLQ orchestration
        │ (DB commit)                              ▲
        ▼                                          │ publish (confirms, mandatory)
   [outbox_event table] ◀─ relay poll ─────────────┘
        │
   ┌──────────────────────────── RabbitMQ ───────────────────────────┐
   │  app.events (topic, AE=app.unrouted) ─rk─▶ <sub>.<event>.q (quorum) │
   │       ▲                                        │ fail (transient)    │
   │       │ TTL hết hạn                            ▼                      │
   │  app.retry (topic) ◀── <sub>.<event>.retry.<i> (durable, TTL)       │
   │                                                │ cạn retry/non-retry/poison
   │                                                ▼                      │
   │  app.dlx (topic) ─────────────────▶ <sub>.<event>.dlq (quorum)      │
   │  app.unrouted (fanout) ───────────▶ app.unrouted.q (quorum, alert)  │
   └─────────────────────────────────────────────────────────────────────┘
```

- **API**: publish event rời trực tiếp; event gắn-DB ghi qua **outbox** (không publish trực tiếp).
- **Worker**: chạy **OutboxRelay** (publish) + **consumers** (consume).

## 4. Topology

Tên exchange suy từ `RABBITMQ_EXCHANGE` (base, mặc định `app`):

| Exchange | Loại | Vai trò |
|---|---|---|
| `app.events` | topic, durable, `alternate-exchange=app.unrouted` | Producer/relay publish; rk = tên event. |
| `app.retry` | topic, durable | Retry-tier queue bind ở đây. |
| `app.dlx` | topic, durable | Dead-letter cuối. |
| `app.unrouted` | fanout, durable | Bắt message không khớp binding nào. |

**Khai báo topology declarative trong shared `messaging.module.ts` → cả API lẫn worker assert** (idempotent), nên exchange/queue/binding tồn tại trước khi có message — không phụ thuộc thứ tự khởi động. (Giải quyết rủi ro unroutable-drop.)

**Per subscription** (vd subscriber `mail` nghe `user.registered`, helper `declareSubscriptionTopology({ subscriber, event })`):

- **Work queue** `mail.user.registered.q` — **quorum**, durable, bound `app.events` rk `user.registered`. Args:
  - `x-dead-letter-exchange: app.dlx`, `x-dead-letter-routing-key: user.registered`
  - `x-delivery-limit: RABBITMQ_QUORUM_DELIVERY_LIMIT` (backstop crash-loop).
- **Retry-tier queues** `mail.user.registered.retry.<i>` — **durable classic**, args:
  - `x-message-ttl: <delay tier i>`
  - `x-dead-letter-exchange: app.events`, `x-dead-letter-routing-key: user.registered` (hết TTL → quay về work queue).
  - bound `app.retry` rk riêng theo tier (`mail.user.registered.r<i>`).
- **DLQ** `mail.user.registered.dlq` — **quorum**, durable, bound `app.dlx` rk `user.registered`. Giám sát, không auto-consumer (parking lot).

**`app.unrouted.q`** — quorum, durable, bound `app.unrouted`; có log/alert (message lọt ra = thiếu binding/cấu hình sai).

> Per-subscriber queue → thêm subscriber mới (vd `analytics.user.registered.q`) chỉ cần khai báo subscription mới, không đụng subscriber cũ.
> Dùng tiered queues (1 queue/tier) thay vì per-message TTL → tránh head-of-line blocking.

## 5. Luồng retry (tiered backoff)

1. Handler lỗi → wrapper đọc header `x-attempt` (mặc định 0).
2. **Non-retryable** (payload sai schema, lỗi nghiệp vụ vĩnh viễn): `await` publish `app.dlx` → **ack**. Không retry.
3. `x-attempt < RABBITMQ_MAX_RETRIES`: `await` publish `app.retry` đúng tier (`rk = <sub>.<event>.r<attempt>`), tăng `x-attempt`, gắn `x-error` → **ack**. Hết TTL tier → về work queue.
4. `x-attempt ≥ RABBITMQ_MAX_RETRIES`: `await` publish `app.dlx` (kèm `x-error`/`x-attempt`/`x-failed-at`) → **ack**.
5. **Publish trong các bước trên BẮT BUỘC dùng confirm channel + `await`.** Nếu publish FAIL → **KHÔNG ack** bản gốc → trả `Nack(true)` (requeue) để không mất message; `x-delivery-limit` chặn loop vô hạn.
6. `x-delivery-limit` (quorum) là lưới an toàn độc lập khi consumer chết trước lúc ack.

**Số tier = độ dài `RABBITMQ_RETRY_DELAYS_MS`.** `attempt` vượt số tier → dùng tier cuối.

## 6. Message contract + validation (Zod 4)

- `messaging.contracts.ts`: registry `routingKey → { schema, type }` — single source of truth.
- **Producer/relay** validate payload theo contract trước khi publish (fail fast).
- **Consumer** parse khi nhận; fail → **non-retryable** → DLQ ngay.
- `userRegisteredSchema`: `{ userId: z.uuid(), email: z.email(), name: z.string().optional() }` — `name` **optional** (khớp `register.dto.ts` `name` optional + Prisma `name String?`).

## 7. Idempotency (consumer)

Mỗi message mang `messageId` (uuid, set lúc enqueue outbox / publish trực tiếp; vào AMQP `properties.messageId`). Wrapper tách 2 khóa Redis để retry KHÔNG bị nhầm là "đã xử lý":

1. **Processing lock** `messaging:lock:<messageId>` — `SET NX EX <ngắn>` khi bắt đầu. Nếu đang giữ bởi delivery khác → `Nack(true)` (tránh xử lý song song trùng).
2. **Processed marker** `messaging:done:<messageId>` — chỉ `SET EX RABBITMQ_IDEMPOTENCY_TTL` **SAU khi handler thành công**. Lần nhận lại thấy marker → ack-skip.
3. Lỗi transient: marker KHÔNG được set → retry (cùng messageId) vẫn xử lý lại bình thường; lock hết TTL tự nhả.

Propagate `x-request-id` (producer/relay → header) → log consumer khớp `req.id` của Pino.

## 8. Transactional Outbox

### 8.1 Schema (Prisma — model mới)
```prisma
model OutboxEvent {
  id          String    @id @default(uuid())
  messageId   String    @unique           // = AMQP messageId (idempotency đầu cuối)
  routingKey  String
  payload     Json
  requestId   String?
  status      String    @default("PENDING") // PENDING | PUBLISHED | FAILED
  attempts    Int       @default(0)
  availableAt DateTime  @default(now())    // backoff khi publish lỗi
  createdAt   DateTime  @default(now())
  publishedAt DateTime?
  @@index([status, availableAt])
}
```

### 8.2 Atomic write (ALS transaction context — port giữ nguyên)
- `PrismaService` thêm `AsyncLocalStorage<TxClient>` + getter `db` (trả tx trong ALS, else base client) + `runInTransaction(fn)` (gọi `this.$transaction(tx => als.run(tx, fn))`).
- Repo impl đổi `this.prisma.user` → `this.prisma.db.user` (port **không đổi**, chỉ impl). Áp cho `user.repository.prisma.ts` và outbox impl.
- `TransactionManager` (abstract, core/prisma) `run(fn)` → impl gọi `prisma.runInTransaction`. Service inject `TransactionManager`, **không** inject PrismaService trực tiếp.
- `AuthService.register`:
  ```ts
  return this.tx.run(async () => {
    const user = await this.users.create({ email, password, name });
    await this.outbox.enqueue('user.registered',
      { userId: user.id, email: user.email, name: user.name ?? undefined });
    return user;
  });
  ```
  Cả 2 write dùng ALS tx → atomic.

### 8.3 Relay (worker)
- `OutboxRelay` (worker): vòng lặp `setTimeout` self-scheduling (OnModuleInit start / OnModuleDestroy stop) — không thêm dependency. Mỗi tick:
  - `SELECT ... WHERE status='PENDING' AND availableAt<=now ORDER BY createdAt LIMIT RABBITMQ_OUTBOX_BATCH FOR UPDATE SKIP LOCKED` (cho phép nhiều relay).
  - Mỗi row: `await eventPublisher.publish(routingKey, payload, { messageId, requestId })` (confirm + mandatory). OK → `status=PUBLISHED, publishedAt=now`. Lỗi → `attempts++`, `availableAt=now+backoff`; `attempts ≥ RABBITMQ_OUTBOX_MAX_ATTEMPTS` → `status=FAILED` (alert).
- Quan hệ idempotency đầu cuối: `OutboxEvent.messageId` = AMQP `messageId` → relay publish trùng vẫn bị consumer dedup (mục 7).

## 9. Thành phần (file & trách nhiệm)

**Core (`src/core/messaging/`):**

| File | Trách nhiệm |
|---|---|
| `messaging.module.ts` | `RabbitMQModule.forRootAsync` (uri, 4 exchange, queue+binding declarative, channel+prefetch, `connectionInitOptions.wait=false`, `defaultPublishOptions.persistent=true`, publisher confirms). API: producer-only (`registerHandlers:false`); worker: handlers. `@Global`, export `EventPublisherService`. |
| `messaging.constants.ts` | Tên exchange (từ env), helper tên queue/rk theo `{subscriber,event}`, tên header. |
| `messaging.contracts.ts` | Registry Zod. |
| `event-publisher.service.ts` | `publish(rk, payload, opts?)`: validate contract, set `messageId`/`timestamp`/`x-attempt=0`/`x-request-id`/`persistent`/`mandatory`, `AmqpConnection.publish('app.events', rk, ...)` (await confirm). |
| `topology.ts` | `declareSubscriptionTopology({subscriber,event})` → config work+retry+dlq+binding cho `forRoot`. |
| `consume.ts` | Wrapper bọc `@RabbitSubscribe`: validate → idempotency → try/catch → retry/DLQ (await publish, Nack khi publish fail). |
| `messaging.health.ts` | Health indicator connection golevelup → `/health`. |
| `unrouted.consumer.ts` | (worker) log/alert message vào `app.unrouted.q`. |

**Core (`src/core/prisma/`):** thêm `transaction-manager.port.ts` + impl; sửa `prisma.service.ts` (ALS `db`/`runInTransaction`).

**Core (`src/core/outbox/`):** `outbox.module.ts`, `outbox.repository.port.ts` + `.prisma.ts` (`enqueue`, `claimPending`, `markPublished`, `markFailed`), `outbox-relay.service.ts` (worker), `outbox.event.ts` (kiểu).

**Mail (tách producer):**
- `mail.producer.module.ts` (mới): `BullModule.registerQueue('mail')` + `MailProducer`, export `MailProducer`. **Không** controller.
- `mail.module.ts` (API): import `MailProducerModule` + `MailController`.
- `MailProducer.enqueue`: thêm `jobId = messageId` (dedup tầng BullMQ).

**Feature consumers (worker, per-subscription):**
- `modules/notifications/notifications.module.ts` (API): controller publish trực tiếp qua `EventPublisherService` (event rời, không DB → không outbox). Bỏ `@EventPattern` cũ.
- `modules/notifications/consumers/notifications.consumer.ts` + `notifications-consumer.module.ts` (worker): subscriber `notifications`, `@RabbitSubscribe` `notification.created`.
- `modules/users/consumers/user-registered.consumer.ts` + `users-consumer.module.ts` (worker): subscriber `mail`, `@RabbitSubscribe` `user.registered` → `mailProducer.enqueue({...}, messageId)`. Import `MailProducerModule`.

**Producer wiring:** `AuthModule` import `OutboxModule` (export `OutboxRepository`) + `PrismaModule`-derived `TransactionManager`; `AuthService` inject `TransactionManager` + `OutboxRepository` (KHÔNG cần `MessagingModule` — chỉ ghi outbox, relay ở worker mới publish).

**Bootstrap:**
- `main.ts`: bỏ `connectMicroservice` + `startAllMicroservices` + import `@nestjs/microservices`.
- `worker.module.ts`: import `PrismaModule` + `MessagingModule` (handlers) + `OutboxModule` (+ relay) + `NotificationsConsumerModule` + `UsersConsumerModule`. Cập nhật ghi chú "worker không nạp Prisma/Messaging".

## 10. Cấu hình env (`src/core/config/env.schema.ts`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `RABBITMQ_URL` | (giữ, bắt buộc) | URI broker. |
| `RABBITMQ_EXCHANGE` | `app` | Base → `app.events`/`.retry`/`.dlx`/`.unrouted`. |
| `RABBITMQ_PREFETCH` | `10` | Prefetch/channel. |
| `RABBITMQ_MAX_RETRIES` | `3` | Số retry trước DLQ. |
| `RABBITMQ_RETRY_DELAYS_MS` | `5000,30000,300000` | Delay từng tier (CSV); số phần tử = số tier. |
| `RABBITMQ_QUORUM_DELIVERY_LIMIT` | `5` | `x-delivery-limit`. |
| `RABBITMQ_IDEMPOTENCY_TTL` | `86400` (giây) | TTL processed marker. |
| `RABBITMQ_OUTBOX_POLL_MS` | `1000` | Chu kỳ poll relay. |
| `RABBITMQ_OUTBOX_BATCH` | `50` | Số row/tick. |
| `RABBITMQ_OUTBOX_MAX_ATTEMPTS` | `10` | Trước khi đánh `FAILED`. |

**Bỏ** `RABBITMQ_QUEUE`. Cập nhật `.env.example`.

## 11. Observability

- Pino ở mọi consumer/relay: nhận / thành công / retry (tier, attempt) / DLQ / outbox publish-fail (kèm error). Không `console.log`.
- Propagate `x-request-id` xuyên process.
- `GET /health` (API & worker) thêm `rabbitmq: 'up'|'down'`.

## 12. Testing

**Unit** (`test/unit/...`, mock `AmqpConnection`/repo PORT bằng `useValue`; alias import; `jest.clearAllMocks()` trong `beforeEach`):
- `event-publisher.service.spec.ts`: validate trước publish; set messageId/headers/persistent/mandatory; publish đúng exchange/rk; payload sai → ném lỗi.
- `consume.spec.ts`: định tuyến tier theo `x-attempt`; cạn retry → DLQ; payload sai → DLQ ngay; **processed marker chỉ set sau success** (transient fail → KHÔNG skip retry); publish fail → `Nack(true)` không ack.
- `contracts.spec.ts`: accept/reject mẫu (gồm `name` thiếu vẫn hợp lệ).
- `outbox-relay.service.spec.ts`: claim PENDING → publish → markPublished; publish fail → attempts++/availableAt; cạn attempts → FAILED.
- `auth.service.spec.ts` (bổ sung): `register` chạy trong `TransactionManager.run`, gọi `outbox.enqueue('user.registered', ...)`.
- `user-registered.consumer.spec.ts`: gọi `MailProducer.enqueue` đúng tham số + `jobId=messageId`.

**Integration** (tùy chọn, ghi chú chạy thủ công): RMQ thật (testcontainers) — publish → consume → DLQ sau cạn retry; outbox → relay → broker.

## 13. Dependencies

- **Thêm:** `@golevelup/nestjs-rabbitmq` (kéo `amqplib`/`amqp-connection-manager` đã có).
- **Không thêm** lib transaction (ALS hand-rolled) hay scheduler (relay tự `setTimeout`).
- **Gỡ (cleanup):** ngừng dùng `@nestjs/microservices` cho RMQ; gỡ package nếu không nơi nào khác dùng (xác nhận: chỉ `notifications` + `main.ts`).

## 14. Ngoài phạm vi (YAGNI)

- RPC/request-reply qua RabbitMQ (chỉ pub/sub).
- RabbitMQ 4.3 native delayed-retry (quá mới/phụ thuộc version).
- UI quản trị/reprocess DLQ (chỉ giám sát; reprocess thủ công qua management).
- Schema registry/versioning event nâng cao (chỉ Zod contract tĩnh).
- Outbox: partition/sharding, change-data-capture (poll đơn giản `FOR UPDATE SKIP LOCKED` là đủ).

## 15. Rủi ro & lưu ý

- **Đổi thư viện** breaking với RMQ hiện tại → sửa `notifications` + `main.ts` đồng bộ.
- **Worker giờ mở Prisma + RMQ** (trước không) → cập nhật code + CLAUDE.md; `connectionInitOptions.wait=false` để worker boot kể cả broker chưa sẵn sàng.
- **ALS transaction context** đổi mọi repo impl `this.prisma.X` → `this.prisma.db.X` (hiện chỉ `user` repo) — cơ học nhưng phải nhất quán, nếu sót → write nằm ngoài transaction.
- **Quorum yêu cầu RMQ ≥ 3.8**; **đổi loại/args queue không sửa tại chỗ** → xóa/migrate queue cũ (`notifications_queue`) khi triển khai.
- **Migration Prisma** thêm `OutboxEvent` (`pnpm prisma:migrate` + `prisma:generate`).
- **Relay nhiều instance**: `FOR UPDATE SKIP LOCKED` để không publish trùng; vẫn at-least-once (consumer dedup lo phần trùng).
