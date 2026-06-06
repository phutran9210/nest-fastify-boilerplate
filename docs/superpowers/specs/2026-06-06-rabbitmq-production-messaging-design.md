# Thiết kế: Nền tảng RabbitMQ chuẩn production

- **Ngày:** 2026-06-06
- **Trạng thái:** Đã duyệt design (chờ review spec)
- **Phạm vi:** Xây lớp messaging hạ tầng tái dùng trên RabbitMQ cho toàn dự án `nest-fastify`. Thay thế setup demo hiện tại (`@nestjs/microservices` RMQ transport, 1 queue, không DLQ/retry). Bổ sung 1 event nghiệp vụ thật `user.registered → gửi mail` làm tham chiếu.

---

## 1. Bối cảnh & hiện trạng

Hiện tại RabbitMQ ở mức demo:

- `@nestjs/microservices` + `Transport.RMQ` (qua `amqp-connection-manager`/`amqplib`).
- 1 queue duy nhất `notifications_queue` (`durable: true`), **không** exchange tùy biến, **không** DLX/DLQ, **không** retry/backoff, **không** manual ack/prefetch tường minh, **không** idempotency.
- Producer: `ClientProxy` (`RMQ_CLIENT`) → `.emit('notification.created', ...)`.
- Consumer: `@EventPattern` chạy **trong API process** (`connectMicroservice` + `startAllMicroservices` ở `main.ts`).

Mục tiêu: nâng lên **nền tảng messaging tái dùng** chuẩn production để mọi module dùng chung.

## 2. Quyết định kiến trúc (đã chốt)

| Quyết định | Lựa chọn | Lý do |
|---|---|---|
| Thư viện | **`@golevelup/nestjs-rabbitmq`** (thay `@nestjs/microservices` RMQ) | Toàn quyền topology (exchange/binding/DLX/quorum), `@RabbitSubscribe` + `Nack`, prefetch theo channel, connection resilience built-in. |
| Vị trí consumer | **Worker process** (chung với BullMQ) | Cả BullMQ job lẫn RMQ consumer đều là background work → gom 1 process; API giữ event-loop sạch (chỉ producer). Tách process riêng về sau dễ vì handler/topology đã cô lập. |
| Loại queue | **Quorum queues** (RMQ ≥ 3.8) | Bền vững/HA; `x-delivery-limit` tự dead-letter poison message. |
| Chiến lược retry | **Tiered backoff** (mặc định 5s / 30s / 5m, configurable) | Backoff version-agnostic qua retry-tier queue + TTL; `x-delivery-limit` là backstop crash-loop độc lập. |
| Event nghiệp vụ mẫu | **`user.registered → gửi mail`** | Luồng thật: API publish → worker consume → enqueue BullMQ mail job → `MailProcessor` gửi. |

**Yêu cầu hạ tầng:** RabbitMQ **≥ 3.8** (cần quorum queues).

## 3. Kiến trúc tổng quan

```
API process (main.ts)                 Worker process (main.worker.ts)
  EventPublisherService                  RMQ consumers (@RabbitSubscribe)
  publish → app.events                   validate → idempotency → handle
  (BỎ connectMicroservice)               retry/DLQ orchestration
        │                                        ▲
        ▼                                        │
   ┌──────────────────────── RabbitMQ ───────────────────────┐
   │  app.events (topic) ──rk──▶ <feat>.<event>.q (quorum)    │
   │       ▲                          │ fail (transient)       │
   │       │ TTL hết hạn              ▼                         │
   │  app.retry (topic) ◀── retry-tier queues (5s/30s/5m)     │
   │                                  │ cạn retry / non-retry / poison
   │                                  ▼                         │
   │  app.dlx (topic) ───────▶ <feat>.<event>.dlq (quorum)    │
   └──────────────────────────────────────────────────────────┘
```

- **API** chỉ publish (producer). Không còn microservice consumer.
- **Worker** chạy consumer, validate, idempotency, và điều phối retry/DLQ.

## 4. Topology

Tên exchange suy ra từ `RABBITMQ_EXCHANGE` (base, mặc định `app`):

| Exchange | Loại | Vai trò |
|---|---|---|
| `app.events` | topic, durable | Producer publish; routing key = tên event (`user.registered`, `notification.created`). |
| `app.retry` | topic, durable | Nơi message chờ backoff (retry-tier queue bind ở đây). |
| `app.dlx` | topic, durable | Dead-letter cuối (poison / cạn retry / non-retryable). |

**Per event** (vd `user.registered`, helper `declareEventTopology()` dựng tự động):

- **Work queue** `users.registered.q` — **quorum** (`x-queue-type: quorum`), durable, bound `app.events` rk `user.registered`. Args:
  - `x-dead-letter-exchange: app.dlx`
  - `x-dead-letter-routing-key: user.registered`
  - `x-delivery-limit: RABBITMQ_QUORUM_DELIVERY_LIMIT` (backstop crash-loop).
- **Retry-tier queues** `users.registered.retry.<i>` — mỗi delay 1 queue, args:
  - `x-message-ttl: <delay tier i>`
  - `x-dead-letter-exchange: app.events`, `x-dead-letter-routing-key: user.registered` (hết TTL → quay về work queue).
  - bound `app.retry` với rk riêng theo tier (vd `user.registered.r0`).
- **DLQ** `users.registered.dlq` — quorum, durable, bound `app.dlx` rk `user.registered`. Có giám sát, không auto-consumer (parking lot).

> Dùng **tiered retry queues** (1 queue/tier) thay vì 1 retry queue + per-message TTL để tránh head-of-line blocking (message TTL dài chặn message TTL ngắn phía sau).

## 5. Luồng retry (tiered backoff)

1. Handler lỗi → wrapper đọc header `x-attempt` (mặc định 0).
2. Nếu lỗi **non-retryable** (payload sai schema, lỗi nghiệp vụ vĩnh viễn) → publish thẳng `app.dlx` rồi **ack** bản gốc. Không retry.
3. Nếu `x-attempt < RABBITMQ_MAX_RETRIES`: republish sang `app.retry` đúng tier (`rk = <event>.r<attempt>`), tăng `x-attempt`, gắn header lỗi gần nhất → **ack** bản gốc. Hết TTL tier → dead-letter về `app.events` → work queue → xử lý lại.
4. Nếu `x-attempt ≥ RABBITMQ_MAX_RETRIES`: publish sang `app.dlx` (kèm `x-error`, `x-attempt`, `x-failed-at`) → **ack** bản gốc.
5. `x-delivery-limit` (quorum) là lưới an toàn **độc lập**: khi consumer chết trước lúc ack (redelivery lặp), quorum tự dead-letter sang `app.dlx` sau N lần.

**Số tier = độ dài `RABBITMQ_RETRY_DELAYS_MS`.** Nếu `attempt` vượt số tier có sẵn → dùng tier cuối cùng.

## 6. Message contract + validation (Zod 4)

- `messaging.contracts.ts`: registry `routingKey → { schema: ZodSchema, type }` — single source of truth cho mọi event.
  ```ts
  export const EventContracts = {
    'user.registered': userRegisteredSchema,
    'notification.created': notificationCreatedSchema,
  } as const;
  ```
- **Producer**: `EventPublisherService.publish(routingKey, payload)` validate `payload` theo contract trước khi gửi (fail fast, ném lỗi tại nơi publish).
- **Consumer**: wrapper parse payload theo contract khi nhận; parse fail → **non-retryable** → DLQ ngay (bước 5.2).

## 7. Idempotency

- Mỗi message mang `messageId` (uuid, set lúc publish, vào AMQP `properties.messageId`).
- Consumer wrapper: `SET messaging:dedup:<messageId> 1 NX EX RABBITMQ_IDEMPOTENCY_TTL` qua Redis (`CacheService`/`LockService` sẵn có). Nếu key đã tồn tại → ack-skip (đã xử lý).
- Propagate `x-request-id` từ producer → header message → log của consumer để truy vết xuyên process (khớp `req.id` của Pino).

## 8. Thành phần (file & trách nhiệm)

**Core (`src/core/messaging/`)** — viết lại:

| File | Trách nhiệm |
|---|---|
| `messaging.module.ts` | `RabbitMQModule.forRootAsync` (uri, exchanges `app.events`/`app.retry`/`app.dlx`, channel + prefetch, `connectionInitOptions.wait=false`, `defaultPublishOptions.persistent=true`). Tham số hóa: API import ở chế độ **producer-only** (`registerHandlers: false`); worker import có handlers. Export `EventPublisherService`. `@Global`. |
| `messaging.constants.ts` | Tên exchange (suy từ env), helper tên queue/routing-key per event, tên header (`x-attempt`, `x-error`, `x-failed-at`, `x-request-id`). |
| `messaging.contracts.ts` | Registry Zod `routingKey → schema/type`. |
| `event-publisher.service.ts` | `publish(routingKey, payload, opts?)`: validate contract, set `messageId`/`timestamp`/`x-attempt=0`/`x-request-id`/`persistent`, gọi `AmqpConnection.publish('app.events', rk, ...)`. |
| `topology.ts` | `declareEventTopology(event)`: dựng work queue (quorum + DLX + delivery-limit) + retry-tier queues + DLQ + bindings. Dùng ở consumer module. |
| `consume.ts` | Higher-order wrapper bọc handler `@RabbitSubscribe`: validate → idempotency → try/catch → định tuyến retry/DLQ. Trả `Nack`/ack đúng. |
| `messaging.health.ts` | Health indicator trạng thái connection golevelup, gắn vào `GET /health`. |

**Feature (tách đôi như BullMQ producer/consumer):**

- `modules/notifications/notifications.module.ts` (API): controller publish qua `EventPublisherService`. Bỏ `@EventPattern` consumer cũ.
- `modules/notifications/notifications-consumer.module.ts` (worker): `@RabbitSubscribe` handler + `declareEventTopology('notification.created')`.
- `modules/notifications/consumers/notifications.consumer.ts`: handler.

**Event nghiệp vụ `user.registered`:**

- `AuthService.register()` (sau khi `users.create`): `eventPublisher.publish('user.registered', { userId, email, name })`. Inject `EventPublisherService`; `AuthModule`/`UsersModule` import `MessagingModule`.
- `modules/users/users-consumer.module.ts` (worker): `@RabbitSubscribe` `user.registered` + topology. Import `MailModule` để dùng `MailProducer`.
- `modules/users/consumers/user-registered.consumer.ts`: handler → `mailProducer.enqueue({ to: email, subject, body })` (chuỗi RMQ → BullMQ → `MailProcessor`).
- Contract `userRegisteredSchema`: `{ userId: string (uuid), email: string (email), name: string }`.

**Bootstrap:**

- `main.ts`: bỏ `connectMicroservice` + `startAllMicroservices` + import `@nestjs/microservices`.
- `worker.module.ts`: import `MessagingModule` (consumer mode) + `NotificationsConsumerModule` + `UsersConsumerModule`. Cập nhật ghi chú "worker không nạp Messaging".

## 9. Cấu hình env (`src/core/config/env.schema.ts`)

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `RABBITMQ_URL` | (giữ, bắt buộc) | URI broker. |
| `RABBITMQ_EXCHANGE` | `app` | Base name → `app.events`/`app.retry`/`app.dlx`. |
| `RABBITMQ_PREFETCH` | `10` | Prefetch/channel consumer. |
| `RABBITMQ_MAX_RETRIES` | `3` | Số lần retry trước khi vào DLQ. |
| `RABBITMQ_RETRY_DELAYS_MS` | `5000,30000,300000` | Delay từng tier (CSV). Số phần tử = số tier. |
| `RABBITMQ_QUORUM_DELIVERY_LIMIT` | `5` | `x-delivery-limit` backstop quorum. |
| `RABBITMQ_IDEMPOTENCY_TTL` | `86400` (giây) | TTL key dedup Redis. |

**Bỏ** `RABBITMQ_QUEUE` (thay bằng topology naming). Cập nhật `.env.example`.

## 10. Observability

- Log qua Pino (`Logger`/`PinoLogger`) ở mọi consumer: nhận / thành công / retry (tier, attempt) / DLQ (kèm error). **Không** `console.log`.
- Propagate `x-request-id` để log consumer khớp request gốc bên API.
- Health: `GET /health` (cả API & worker) thêm field `rabbitmq: 'up'|'down'` từ `messaging.health.ts`.

## 11. Testing

- **Unit** (`test/unit/...`, mock `AmqpConnection` bằng `useValue` plain object; alias import; `jest.clearAllMocks()` trong `beforeEach`):
  - `event-publisher.service.spec.ts`: validate contract trước publish; set messageId/headers/persistent; gọi `publish` đúng exchange/rk; payload sai → ném lỗi.
  - `consume.spec.ts`: định tuyến tier theo `x-attempt`; cạn retry → DLQ; payload sai schema → DLQ ngay (non-retryable); idempotency skip khi đã xử lý.
  - `contracts.spec.ts`: schema accept/reject mẫu hợp lệ/sai.
  - `user-registered.consumer.spec.ts`: handler gọi `MailProducer.enqueue` đúng tham số.
- **Integration** (tùy chọn, ghi chú chạy thủ công): RMQ thật qua testcontainers — publish → consume → kiểm tra DLQ sau khi cạn retry. Không bắt buộc trong CI nếu thiếu hạ tầng.

## 12. Dependencies

- **Thêm:** `@golevelup/nestjs-rabbitmq` (kéo theo `amqplib`/`amqp-connection-manager` đã có).
- **Gỡ (cleanup):** ngừng dùng `@nestjs/microservices` cho RMQ. Gỡ package nếu không nơi nào khác dùng (xác nhận: chỉ `notifications` + `main.ts` đang dùng).

## 13. Ngoài phạm vi (YAGNI)

- RPC/request-reply qua RabbitMQ (chỉ làm pub/sub event-driven).
- RabbitMQ 4.3 native delayed-retry (quá mới, phụ thuộc version; tiered-queue version-agnostic hơn).
- UI quản trị DLQ (chỉ giám sát; reprocess thủ công qua RabbitMQ management).
- Schema registry/versioning event nâng cao (chỉ Zod contract tĩnh; versioning để sau).

## 14. Rủi ro & lưu ý

- **Đổi thư viện** là breaking với code RMQ hiện tại → phải sửa `notifications` controller + `main.ts` đồng bộ.
- **Worker giờ mở kết nối RMQ** (trước đây không) → cập nhật ghi chú & CLAUDE.md; đảm bảo `connectionInitOptions.wait=false` để worker boot kể cả khi broker chưa sẵn sàng.
- **Quorum queue yêu cầu RMQ ≥ 3.8** — môi trường deploy phải đáp ứng.
- **Đổi loại/args queue** không thể sửa tại chỗ trên queue đã tồn tại → cần xóa/migrate queue cũ (`notifications_queue`) khi triển khai.
