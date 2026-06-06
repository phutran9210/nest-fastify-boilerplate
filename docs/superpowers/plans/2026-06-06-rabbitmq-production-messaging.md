# RabbitMQ Production Messaging — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thay setup RabbitMQ demo bằng nền tảng messaging tái dùng chuẩn production: topology (exchange/quorum queue/DLX/retry-tier/alternate-exchange), tiered-backoff retry, idempotency, transactional outbox, và event mẫu `user.registered → gửi mail`.

**Architecture:** API là producer (publish event rời trực tiếp; event gắn-DB ghi qua outbox trong cùng transaction). Worker chạy OutboxRelay (poll DB → publish, confirm) + RMQ consumers (`@RabbitSubscribe`) với wrapper validate→idempotency→retry/DLQ. Topology assert tập trung từ `topology.ts`, cả 2 process cùng assert.

**Tech Stack:** NestJS 11 + Fastify, `@golevelup/nestjs-rabbitmq`, RabbitMQ ≥ 3.8 (quorum), Prisma 7, Zod 4, BullMQ, ioredis, Pino, Jest.

**Spec:** `docs/superpowers/specs/2026-06-06-rabbitmq-production-messaging-design.md`

**Quy ước thực thi:** mỗi task chạy `pnpm check` (Biome) trước commit. Test unit ở `test/unit/<mirror-src>`, import bằng alias (`@core/*`, `@modules/*`, `@common/*`, `@generated/*`), `jest.clearAllMocks()` trong `beforeEach`, mock PORT/`AmqpConnection` bằng `useValue`.

---

## Phase 0 — Dependencies, env, schema

### Task 1: Cài golevelup + verify API version

**Files:**
- Modify: `package.json` (qua pnpm)

- [ ] **Step 1: Cài package**

Run: `pnpm add @golevelup/nestjs-rabbitmq`
Expected: thêm vào `dependencies`, `pnpm-lock.yaml` cập nhật.

- [ ] **Step 2: Verify 3 điểm phụ-thuộc-version (đọc type của bản đã cài)**

Run: `grep -RnE "registerHandlers|createQueueIfNotExists|queues\??:|alternateExchange|publish\(" node_modules/@golevelup/nestjs-rabbitmq/lib/rabbitmq.interfaces.d.ts node_modules/@golevelup/nestjs-rabbitmq/lib/amqp/connection.d.ts | head -40`
Expected: thấy `registerHandlers?: boolean`, `createQueueIfNotExists?: boolean`, `queues?: RabbitMQQueueConfig[]` trong config, và `publish(...)` của `AmqpConnection`.

Ghi chú ngay vào commit message kết quả verify. Nếu `publish` trả `void` (không phải `Promise`), Task 8/9 sẽ publish qua `amqp.managedChannel`/confirm channel thay cho `await amqp.publish`. Nếu không có top-level `queues`, Task 6/7 chuyển sang assert bằng `amqp.managedConnection.addSetup(...)`.

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build: thêm @golevelup/nestjs-rabbitmq (verify registerHandlers/queues/publish)"
```

---

### Task 2: Thêm env vars messaging

**Files:**
- Modify: `src/core/config/env.schema.ts`
- Modify: `.env.example`

- [ ] **Step 1: Thêm field vào Zod env schema**

Trong `src/core/config/env.schema.ts`, thay block `RABBITMQ_*` hiện tại (xoá `RABBITMQ_QUEUE`) bằng:

```ts
    RABBITMQ_URL: z.url(),
    RABBITMQ_EXCHANGE: z.string().default('app'),
    RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
    RABBITMQ_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
    // CSV milliseconds, mỗi phần tử = 1 retry tier (5s, 30s, 5m).
    RABBITMQ_RETRY_DELAYS_MS: z
      .string()
      .default('5000,30000,300000')
      .transform((s) => s.split(',').map((n) => Number(n.trim())))
      .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n > 0), {
        message: 'RABBITMQ_RETRY_DELAYS_MS phải là danh sách số ms dương, cách nhau bằng dấu phẩy',
      }),
    RABBITMQ_QUORUM_DELIVERY_LIMIT: z.coerce.number().int().positive().default(5),
    RABBITMQ_IDEMPOTENCY_TTL: z.coerce.number().int().positive().default(86400), // giây
    RABBITMQ_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
    RABBITMQ_OUTBOX_BATCH: z.coerce.number().int().positive().default(50),
    RABBITMQ_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),
```

- [ ] **Step 2: Cập nhật `.env.example`**

Thay dòng `RABBITMQ_QUEUE=...` (nếu có) và bổ sung dưới `RABBITMQ_URL`:

```bash
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_EXCHANGE=app
RABBITMQ_PREFETCH=10
RABBITMQ_MAX_RETRIES=3
RABBITMQ_RETRY_DELAYS_MS=5000,30000,300000
RABBITMQ_QUORUM_DELIVERY_LIMIT=5
RABBITMQ_IDEMPOTENCY_TTL=86400
RABBITMQ_OUTBOX_POLL_MS=1000
RABBITMQ_OUTBOX_BATCH=50
RABBITMQ_OUTBOX_MAX_ATTEMPTS=10
```

- [ ] **Step 3: Verify env parse**

Run: `pnpm typecheck`
Expected: PASS (không lỗi type ở env.schema).

- [ ] **Step 4: Commit**

```bash
git add src/core/config/env.schema.ts .env.example
git commit -m "feat(config): env messaging (exchange, prefetch, retry tiers, outbox); bỏ RABBITMQ_QUEUE"
```

---

### Task 3: Prisma model OutboxEvent + migration

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Thêm model**

Thêm vào cuối `prisma/schema.prisma`:

```prisma
model OutboxEvent {
  id          String    @id @default(uuid())
  messageId   String    @unique
  routingKey  String
  payload     Json
  requestId   String?
  status      String    @default("PENDING") // PENDING | PUBLISHED | FAILED
  attempts    Int       @default(0)
  availableAt DateTime  @default(now())
  createdAt   DateTime  @default(now())
  publishedAt DateTime?

  @@index([status, availableAt])
}
```

- [ ] **Step 2: Tạo migration + generate client**

Run: `pnpm prisma:migrate -- --name add_outbox_event` (nếu script không nhận arg: `pnpm exec prisma migrate dev --name add_outbox_event`)
Expected: tạo `prisma/migrations/<ts>_add_outbox_event/`, client sinh lại có `prisma.outboxEvent`.

Run: `pnpm prisma:generate`
Expected: `src/generated/prisma` cập nhật.

- [ ] **Step 3: Verify type**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations src/generated/prisma
git commit -m "feat(prisma): model OutboxEvent cho transactional outbox"
```

---

## Phase 1 — Transaction context (ALS)

### Task 4: PrismaService ALS `db` + `runInTransaction`

**Files:**
- Modify: `src/core/prisma/prisma.service.ts`
- Test: `test/unit/core/prisma/prisma.service.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { PrismaService } from '@core/prisma/prisma.service';

describe('PrismaService transaction context', () => {
  // Tạo instance KHÔNG gọi super connect: dùng Object.create để test logic ALS thuần.
  const svc = Object.create(PrismaService.prototype) as PrismaService;

  it('db trả base client khi ngoài transaction', () => {
    expect(svc.db).toBe(svc);
  });

  it('db trả tx client khi trong runInTransaction', async () => {
    const fakeTx = { marker: 'tx' } as unknown;
    // Giả lập $transaction gọi callback với fakeTx.
    (svc as any).$transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx);
    const seen = await svc.runInTransaction(async () => svc.db);
    expect(seen).toBe(fakeTx);
    // Ngoài transaction lại trả base.
    expect(svc.db).toBe(svc);
  });
});
```

- [ ] **Step 2: Run test (fail)**

Run: `pnpm test -- prisma.service`
Expected: FAIL (`db` / `runInTransaction` chưa tồn tại).

- [ ] **Step 3: Implement**

Sửa `src/core/prisma/prisma.service.ts` thành:

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { PrismaClient } from '@generated/prisma/client';
import { Injectable, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';

// Tx client = phần PrismaClient không có $transaction/$connect... Dùng kiểu rộng để tránh phụ thuộc tên.
type TxClient = Omit<PrismaClient, '$connect' | '$disconnect' | '$transaction' | '$on' | '$extends'>;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  // Lưu tx client hiện hành theo async context → repo lấy đúng client mà không đổi chữ ký port.
  private readonly als = new AsyncLocalStorage<TxClient>();

  constructor(config: ConfigService) {
    super({
      adapter: new PrismaPg({ connectionString: config.getOrThrow<string>('DATABASE_URL') }),
    });
  }

  // Repo dùng `this.prisma.db.user...` thay cho `this.prisma.user...`:
  // trong transaction → tx client; ngoài → base client (this).
  get db(): TxClient {
    return this.als.getStore() ?? this;
  }

  // Chạy fn trong 1 transaction tương tác; mọi repo dùng `db` bên trong đều atomic.
  runInTransaction<T>(fn: () => Promise<T>): Promise<T> {
    return this.$transaction((tx) => this.als.run(tx as TxClient, fn));
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Run test (pass)**

Run: `pnpm test -- prisma.service`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/prisma/prisma.service.ts test/unit/core/prisma/prisma.service.spec.ts
git commit -m "feat(prisma): transaction context qua AsyncLocalStorage (db + runInTransaction)"
```

---

### Task 5: TransactionManager port + impl

**Files:**
- Create: `src/core/prisma/transaction-manager.port.ts`
- Create: `src/core/prisma/transaction-manager.prisma.ts`
- Modify: `src/core/prisma/prisma.module.ts`

- [ ] **Step 1: Viết PORT**

`src/core/prisma/transaction-manager.port.ts`:

```ts
// PORT — abstract class vừa là type vừa là DI token. Service nghiệp vụ inject cái này,
// KHÔNG inject PrismaService trực tiếp (giữ nguyên quy ước repo port).
export abstract class TransactionManager {
  abstract run<T>(fn: () => Promise<T>): Promise<T>;
}
```

- [ ] **Step 2: Viết IMPL**

`src/core/prisma/transaction-manager.prisma.ts`:

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionManager } from './transaction-manager.port';

@Injectable()
export class PrismaTransactionManager extends TransactionManager {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  run<T>(fn: () => Promise<T>): Promise<T> {
    return this.prisma.runInTransaction(fn);
  }
}
```

- [ ] **Step 3: Wiring + export**

Sửa `src/core/prisma/prisma.module.ts`:

```ts
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionManager } from './transaction-manager.port';
import { PrismaTransactionManager } from './transaction-manager.prisma';

@Global()
@Module({
  providers: [
    PrismaService,
    { provide: TransactionManager, useClass: PrismaTransactionManager },
  ],
  exports: [PrismaService, TransactionManager],
})
export class PrismaModule {}
```

- [ ] **Step 4: Verify**

Run: `pnpm typecheck && pnpm check`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/prisma/transaction-manager.port.ts src/core/prisma/transaction-manager.prisma.ts src/core/prisma/prisma.module.ts
git commit -m "feat(prisma): TransactionManager port + Prisma impl"
```

---

### Task 6: Repo user dùng `prisma.db`

**Files:**
- Modify: `src/modules/users/repositories/user.repository.prisma.ts`

- [ ] **Step 1: Đổi mọi truy cập `this.prisma.user` → `this.prisma.db.user`**

Trong `user.repository.prisma.ts`, thay tất cả `this.prisma.user.<...>` thành `this.prisma.db.user.<...>` (5 chỗ: findUnique x2, findMany, count, create, update, delete). Ví dụ:

```ts
  findById(id: string): Promise<User | null> {
    return this.prisma.db.user.findUnique({ where: { id } });
  }
  // ... áp tương tự cho findByEmail/findAll/count/create/update/delete
```

- [ ] **Step 2: Verify test cũ vẫn xanh**

Run: `pnpm test -- users && pnpm typecheck`
Expected: PASS (repo impl không có unit test mock Prisma → chủ yếu typecheck + users.service test xanh).

- [ ] **Step 3: Commit**

```bash
git add src/modules/users/repositories/user.repository.prisma.ts
git commit -m "refactor(users): repo dùng prisma.db (transaction-aware)"
```

---

## Phase 2 — Messaging core

### Task 7: Hằng số tên & helper topology

**Files:**
- Create: `src/core/messaging/messaging.constants.ts`
- Test: `test/unit/core/messaging/messaging.constants.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import {
  dlqName,
  exchangeNames,
  retryQueueName,
  retryRoutingKey,
  unroutedQueueName,
  workQueueName,
} from '@core/messaging/messaging.constants';

describe('messaging.constants', () => {
  it('exchangeNames suy ra từ base', () => {
    expect(exchangeNames('app')).toEqual({
      events: 'app.events',
      retry: 'app.retry',
      dlx: 'app.dlx',
      unrouted: 'app.unrouted',
    });
  });

  it('tên queue/rk theo subscriber+event', () => {
    expect(workQueueName('mail', 'user.registered')).toBe('mail.user.registered.q');
    expect(retryQueueName('mail', 'user.registered', 1)).toBe('mail.user.registered.retry.1');
    expect(retryRoutingKey('mail', 'user.registered', 1)).toBe('mail.user.registered.r1');
    expect(dlqName('mail', 'user.registered')).toBe('mail.user.registered.dlq');
    expect(unroutedQueueName('app')).toBe('app.unrouted.q');
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- messaging.constants`
Expected: FAIL (module chưa tồn tại).

- [ ] **Step 3: Implement**

`src/core/messaging/messaging.constants.ts`:

```ts
// Tên AMQP header dùng xuyên producer/relay/consumer.
export const MessagingHeaders = {
  ATTEMPT: 'x-attempt',
  ERROR: 'x-error',
  FAILED_AT: 'x-failed-at',
  REQUEST_ID: 'x-request-id',
} as const;

export function exchangeNames(base: string) {
  return {
    events: `${base}.events`,
    retry: `${base}.retry`,
    dlx: `${base}.dlx`,
    unrouted: `${base}.unrouted`,
  };
}

export const workQueueName = (subscriber: string, event: string) => `${subscriber}.${event}.q`;
export const retryQueueName = (subscriber: string, event: string, tier: number) =>
  `${subscriber}.${event}.retry.${tier}`;
export const retryRoutingKey = (subscriber: string, event: string, tier: number) =>
  `${subscriber}.${event}.r${tier}`;
export const dlqName = (subscriber: string, event: string) => `${subscriber}.${event}.dlq`;
export const unroutedQueueName = (base: string) => `${base}.unrouted.q`;
```

- [ ] **Step 4: Run (pass)**

Run: `pnpm test -- messaging.constants`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/messaging.constants.ts test/unit/core/messaging/messaging.constants.spec.ts
git commit -m "feat(messaging): hằng số tên exchange/queue/header"
```

---

### Task 8: Contracts (Zod registry) + danh sách subscription

**Files:**
- Create: `src/core/messaging/messaging.contracts.ts`
- Test: `test/unit/core/messaging/messaging.contracts.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { EventContracts, userRegisteredSchema } from '@core/messaging/messaging.contracts';

describe('messaging.contracts', () => {
  it('user.registered chấp nhận payload đủ và thiếu name (optional)', () => {
    expect(() =>
      userRegisteredSchema.parse({ userId: crypto.randomUUID(), email: 'a@b.com', name: 'A' }),
    ).not.toThrow();
    expect(() =>
      userRegisteredSchema.parse({ userId: crypto.randomUUID(), email: 'a@b.com' }),
    ).not.toThrow();
  });

  it('user.registered từ chối email sai', () => {
    expect(() =>
      userRegisteredSchema.parse({ userId: crypto.randomUUID(), email: 'nope', name: 'A' }),
    ).toThrow();
  });

  it('registry có cả 2 routing key', () => {
    expect(Object.keys(EventContracts).sort()).toEqual([
      'notification.created',
      'user.registered',
    ]);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- messaging.contracts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/messaging/messaging.contracts.ts`:

```ts
import { z } from 'zod';

export const userRegisteredSchema = z.object({
  userId: z.uuid(),
  email: z.email(),
  name: z.string().optional(),
});
export type UserRegistered = z.infer<typeof userRegisteredSchema>;

export const notificationCreatedSchema = z.object({
  userId: z.string(),
  message: z.string(),
});
export type NotificationCreated = z.infer<typeof notificationCreatedSchema>;

// Single source of truth: routingKey → schema.
export const EventContracts = {
  'user.registered': userRegisteredSchema,
  'notification.created': notificationCreatedSchema,
} as const;

export type EventRoutingKey = keyof typeof EventContracts;
export type EventPayload<K extends EventRoutingKey> = z.infer<(typeof EventContracts)[K]>;

// Ai nghe event nào → drive cả khai báo topology lẫn consumer. Thêm subscriber = thêm 1 dòng.
export const SUBSCRIPTIONS = [
  { subscriber: 'mail', event: 'user.registered' },
  { subscriber: 'notifications', event: 'notification.created' },
] as const satisfies ReadonlyArray<{ subscriber: string; event: EventRoutingKey }>;
```

- [ ] **Step 4: Run (pass)**

Run: `pnpm test -- messaging.contracts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/messaging.contracts.ts test/unit/core/messaging/messaging.contracts.spec.ts
git commit -m "feat(messaging): Zod contracts registry + danh sách subscription"
```

---

### Task 9: Topology builder

**Files:**
- Create: `src/core/messaging/topology.ts`
- Test: `test/unit/core/messaging/topology.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { buildExchanges, buildQueues } from '@core/messaging/topology';

const ex = { events: 'app.events', retry: 'app.retry', dlx: 'app.dlx', unrouted: 'app.unrouted' };

describe('topology', () => {
  it('exchanges: events có alternate-exchange, đủ 4 cái', () => {
    const xs = buildExchanges(ex);
    expect(xs.map((x) => x.name).sort()).toEqual([
      'app.dlx',
      'app.events',
      'app.retry',
      'app.unrouted',
    ]);
    const events = xs.find((x) => x.name === 'app.events');
    expect(events?.options?.arguments?.['alternate-exchange']).toBe('app.unrouted');
  });

  it('queues: work quorum + DLX + delivery-limit, retry theo số tier, dlq, unrouted', () => {
    const qs = buildQueues({
      base: 'app',
      exchanges: ex,
      subscriptions: [{ subscriber: 'mail', event: 'user.registered' }],
      retryDelaysMs: [5000, 30000],
      deliveryLimit: 5,
    });
    const work = qs.find((q) => q.name === 'mail.user.registered.q');
    expect(work?.options?.arguments).toMatchObject({
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': 'app.dlx',
      'x-dead-letter-routing-key': 'user.registered',
      'x-delivery-limit': 5,
    });
    expect(qs.filter((q) => q.name.startsWith('mail.user.registered.retry.'))).toHaveLength(2);
    const retry0 = qs.find((q) => q.name === 'mail.user.registered.retry.0');
    expect(retry0?.options?.arguments).toMatchObject({
      'x-message-ttl': 5000,
      'x-dead-letter-exchange': 'app.events',
      'x-dead-letter-routing-key': 'user.registered',
    });
    expect(qs.some((q) => q.name === 'mail.user.registered.dlq')).toBe(true);
    expect(qs.some((q) => q.name === 'app.unrouted.q')).toBe(true);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- topology`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/messaging/topology.ts`:

```ts
import type { RabbitMQExchangeConfig, RabbitMQQueueConfig } from '@golevelup/nestjs-rabbitmq';
import {
  dlqName,
  retryQueueName,
  retryRoutingKey,
  unroutedQueueName,
  workQueueName,
} from './messaging.constants';

type Exchanges = { events: string; retry: string; dlx: string; unrouted: string };

export function buildExchanges(ex: Exchanges): RabbitMQExchangeConfig[] {
  return [
    {
      name: ex.events,
      type: 'topic',
      // Message không khớp binding nào → đẩy sang alternate-exchange thay vì bị drop.
      options: { durable: true, arguments: { 'alternate-exchange': ex.unrouted } },
    },
    { name: ex.retry, type: 'topic', options: { durable: true } },
    { name: ex.dlx, type: 'topic', options: { durable: true } },
    { name: ex.unrouted, type: 'fanout', options: { durable: true } },
  ];
}

export function buildQueues(params: {
  base: string;
  exchanges: Exchanges;
  subscriptions: ReadonlyArray<{ subscriber: string; event: string }>;
  retryDelaysMs: number[];
  deliveryLimit: number;
}): RabbitMQQueueConfig[] {
  const { base, exchanges: ex, subscriptions, retryDelaysMs, deliveryLimit } = params;

  // Queue bắt message unroutable (alternate-exchange fanout).
  const queues: RabbitMQQueueConfig[] = [
    {
      name: unroutedQueueName(base),
      exchange: ex.unrouted,
      routingKey: '',
      createQueueIfNotExists: true,
      options: { durable: true, arguments: { 'x-queue-type': 'quorum' } },
    },
  ];

  for (const { subscriber, event } of subscriptions) {
    // Work queue: quorum + DLX + delivery-limit (backstop crash-loop).
    queues.push({
      name: workQueueName(subscriber, event),
      exchange: ex.events,
      routingKey: event,
      createQueueIfNotExists: true,
      options: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-dead-letter-exchange': ex.dlx,
          'x-dead-letter-routing-key': event,
          'x-delivery-limit': deliveryLimit,
        },
      },
    });

    // Retry-tier queues: durable classic, TTL → dead-letter về events exchange.
    retryDelaysMs.forEach((ttl, i) => {
      queues.push({
        name: retryQueueName(subscriber, event, i),
        exchange: ex.retry,
        routingKey: retryRoutingKey(subscriber, event, i),
        createQueueIfNotExists: true,
        options: {
          durable: true,
          arguments: {
            'x-message-ttl': ttl,
            'x-dead-letter-exchange': ex.events,
            'x-dead-letter-routing-key': event,
          },
        },
      });
    });

    // DLQ: quorum, parking lot.
    queues.push({
      name: dlqName(subscriber, event),
      exchange: ex.dlx,
      routingKey: event,
      createQueueIfNotExists: true,
      options: { durable: true, arguments: { 'x-queue-type': 'quorum' } },
    });
  }

  return queues;
}
```

> Nếu Task 1 phát hiện bản golevelup KHÔNG hỗ trợ top-level `queues`/`createQueueIfNotExists`: giữ nguyên `buildQueues` (vẫn dùng được làm dữ liệu) nhưng ở Task 10 assert qua `amqp.managedConnection.addSetup` lặp `buildQueues(...)` gọi `assertQueue`/`bindQueue`.

- [ ] **Step 4: Run (pass)**

Run: `pnpm test -- topology`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/topology.ts test/unit/core/messaging/topology.spec.ts
git commit -m "feat(messaging): topology builder (exchanges + quorum/retry/dlq/unrouted queues)"
```

---

### Task 10: MessagingModule (forRoot consumer flag)

**Files:**
- Create: `src/core/messaging/messaging.module.ts`

- [ ] **Step 1: Implement**

`src/core/messaging/messaging.module.ts`:

```ts
import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPublisherService } from './event-publisher.service';
import { exchangeNames } from './messaging.constants';
import { SUBSCRIPTIONS } from './messaging.contracts';
import { buildExchanges, buildQueues } from './topology';

@Global()
@Module({})
export class MessagingModule {
  // consumer=false: API (producer-only, registerHandlers:false). consumer=true: worker.
  static forRoot(opts: { consumer: boolean }): DynamicModule {
    return {
      module: MessagingModule,
      imports: [
        RabbitMQModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const base = config.getOrThrow<string>('RABBITMQ_EXCHANGE');
            const ex = exchangeNames(base);
            const retryDelaysMs = config.getOrThrow<number[]>('RABBITMQ_RETRY_DELAYS_MS');
            const deliveryLimit = config.getOrThrow<number>('RABBITMQ_QUORUM_DELIVERY_LIMIT');
            return {
              uri: config.getOrThrow<string>('RABBITMQ_URL'),
              exchanges: buildExchanges(ex),
              queues: buildQueues({
                base,
                exchanges: ex,
                subscriptions: SUBSCRIPTIONS,
                retryDelaysMs,
                deliveryLimit,
              }),
              channels: {
                default: { prefetchCount: config.getOrThrow<number>('RABBITMQ_PREFETCH'), default: true },
              },
              // Boot kể cả khi broker chưa sẵn sàng (đặc biệt cho worker).
              connectionInitOptions: { wait: false },
              // Mọi message persistent mặc định.
              defaultPublishOptions: { persistent: true },
              // API không đăng ký consumer; worker thì có.
              registerHandlers: opts.consumer,
            };
          },
        }),
      ],
      providers: [EventPublisherService],
      exports: [EventPublisherService, RabbitMQModule],
    };
  }
}
```

- [ ] **Step 2: Verify typecheck (EventPublisherService chưa có → tạm thời sẽ lỗi; tạo ở Task 11 rồi quay lại verify)**

Bỏ qua build tới sau Task 11. (Task 11 tạo `EventPublisherService`.)

- [ ] **Step 3: Commit**

```bash
git add src/core/messaging/messaging.module.ts
git commit -m "feat(messaging): MessagingModule.forRoot (topology + registerHandlers theo role)"
```

---

### Task 11: EventPublisherService

**Files:**
- Create: `src/core/messaging/event-publisher.service.ts`
- Test: `test/unit/core/messaging/event-publisher.service.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPublisherService } from '@core/messaging/event-publisher.service';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

describe('EventPublisherService', () => {
  let service: EventPublisherService;
  const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
  const config = { getOrThrow: jest.fn().mockReturnValue('app') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventPublisherService,
        { provide: AmqpConnection, useValue: amqp },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(EventPublisherService);
  });

  it('publish validate + gửi vào app.events với messageId/headers', async () => {
    const id = '11111111-1111-1111-1111-111111111111';
    await service.publish(
      'user.registered',
      { userId: id, email: 'a@b.com', name: 'A' },
      { messageId: 'mid-1', requestId: 'req-1' },
    );
    expect(amqp.publish).toHaveBeenCalledTimes(1);
    const [exchange, rk, payload, options] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.events');
    expect(rk).toBe('user.registered');
    expect(payload).toEqual({ userId: id, email: 'a@b.com', name: 'A' });
    expect(options.messageId).toBe('mid-1');
    expect(options.headers['x-attempt']).toBe(0);
    expect(options.headers['x-request-id']).toBe('req-1');
  });

  it('payload sai contract → ném lỗi, không publish', async () => {
    await expect(
      service.publish('user.registered', { userId: 'not-uuid', email: 'bad' } as never),
    ).rejects.toThrow();
    expect(amqp.publish).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- event-publisher`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/messaging/event-publisher.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  EventContracts,
  type EventPayload,
  type EventRoutingKey,
} from './messaging.contracts';
import { exchangeNames, MessagingHeaders } from './messaging.constants';

@Injectable()
export class EventPublisherService {
  private readonly eventsExchange: string;

  constructor(
    private readonly amqp: AmqpConnection,
    config: ConfigService,
  ) {
    this.eventsExchange = exchangeNames(config.getOrThrow<string>('RABBITMQ_EXCHANGE')).events;
  }

  // Publish event đã validate vào exchange chính. await để bắt lỗi confirm (xem ghi chú version).
  async publish<K extends EventRoutingKey>(
    routingKey: K,
    payload: EventPayload<K>,
    opts?: { messageId?: string; requestId?: string },
  ): Promise<void> {
    const validated = EventContracts[routingKey].parse(payload);
    await this.amqp.publish(this.eventsExchange, routingKey, validated, {
      messageId: opts?.messageId ?? randomUUID(),
      timestamp: Date.now(),
      contentType: 'application/json',
      headers: {
        [MessagingHeaders.ATTEMPT]: 0,
        [MessagingHeaders.REQUEST_ID]: opts?.requestId,
      },
    });
  }
}
```

> Nếu Task 1 xác định `amqp.publish` trả `void` (không confirm): đổi sang `const ch = this.amqp.managedChannel; await ch.publish(...)` (amqp-connection-manager publish trả Promise resolve khi confirm).

- [ ] **Step 4: Run (pass) + typecheck cả MessagingModule**

Run: `pnpm test -- event-publisher && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/event-publisher.service.ts test/unit/core/messaging/event-publisher.service.spec.ts
git commit -m "feat(messaging): EventPublisherService (validate + publish app.events)"
```

---

### Task 12: Consumer wrapper (validate → idempotency → retry/DLQ)

**Files:**
- Create: `src/core/messaging/consume.ts`
- Test: `test/unit/core/messaging/consume.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { CacheService } from '@core/redis/ports/cache.service.port';
import { LockService } from '@core/redis/ports/lock.service.port';
import { MessageConsumer } from '@core/messaging/consume';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

const amqpMsg = (headers: Record<string, unknown>, messageId = 'mid-1') =>
  ({ properties: { headers, messageId } }) as never;

describe('MessageConsumer', () => {
  let consumer: MessageConsumer;
  const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
  const cache = { get: jest.fn(), set: jest.fn(), del: jest.fn(), getOrSet: jest.fn() };
  const lock = { acquire: jest.fn(), withLock: jest.fn() };
  const release = jest.fn().mockResolvedValue(true);
  const config = {
    getOrThrow: jest.fn((k: string) =>
      ({ RABBITMQ_EXCHANGE: 'app', RABBITMQ_MAX_RETRIES: 2, RABBITMQ_IDEMPOTENCY_TTL: 100 })[k],
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    cache.get.mockResolvedValue(null);
    lock.acquire.mockResolvedValue({ key: 'k', token: 't', fencingToken: 1, release });
    const moduleRef = await Test.createTestingModule({
      providers: [
        MessageConsumer,
        { provide: AmqpConnection, useValue: amqp },
        { provide: CacheService, useValue: cache },
        { provide: LockService, useValue: lock },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    consumer = moduleRef.get(MessageConsumer);
  });

  const params = { subscriber: 'mail', routingKey: 'user.registered' as const };
  const good = { userId: '11111111-1111-1111-1111-111111111111', email: 'a@b.com' };

  it('happy path: gọi handler, set processed marker, ack (void)', async () => {
    const handler = jest.fn().mockResolvedValue(undefined);
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(handler).toHaveBeenCalledWith(good);
    expect(cache.set).toHaveBeenCalledWith('messaging:done:mid-1', 1, 100);
    expect(res).toBeUndefined();
    expect(release).toHaveBeenCalled();
  });

  it('đã xử lý (marker tồn tại) → skip handler, ack', async () => {
    cache.get.mockResolvedValue(1);
    const handler = jest.fn();
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(handler).not.toHaveBeenCalled();
    expect(res).toBeUndefined();
  });

  it('không lấy được lock → Nack(requeue)', async () => {
    lock.acquire.mockResolvedValue(null);
    const handler = jest.fn();
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(res).toBeInstanceOf(Nack);
    expect((res as Nack).requeue).toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('payload sai schema → publish DLX, KHÔNG retry, ack', async () => {
    const handler = jest.fn();
    const res = await consumer.handle(params, { userId: 'x' }, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(handler).not.toHaveBeenCalled();
    const [exchange] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.dlx');
    expect(res).toBeUndefined();
  });

  it('handler lỗi & còn lượt → publish retry tier, ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    const [exchange, rk, , options] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.retry');
    expect(rk).toBe('mail.user.registered.r0');
    expect(options.headers['x-attempt']).toBe(1);
    expect(cache.set).not.toHaveBeenCalled(); // marker chỉ set khi success
    expect(res).toBeUndefined();
  });

  it('handler lỗi & cạn lượt → publish DLX, ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 2 }), handler);
    const [exchange] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.dlx');
    expect(res).toBeUndefined();
  });

  it('handler lỗi nhưng publish retry FAIL → Nack(requeue), không ack', async () => {
    const handler = jest.fn().mockRejectedValue(new Error('boom'));
    amqp.publish.mockRejectedValueOnce(new Error('broker down'));
    const res = await consumer.handle(params, good, amqpMsg({ 'x-attempt': 0 }), handler);
    expect(res).toBeInstanceOf(Nack);
    expect((res as Nack).requeue).toBe(true);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- consume`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/core/messaging/consume.ts`:

```ts
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { CacheService } from '@core/redis/ports/cache.service.port';
import { LockService } from '@core/redis/ports/lock.service.port';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import { ZodError } from 'zod';
import {
  EventContracts,
  type EventPayload,
  type EventRoutingKey,
} from './messaging.contracts';
import { exchangeNames, MessagingHeaders, retryRoutingKey } from './messaging.constants';

const PROCESSING_LOCK_TTL_MS = 30_000;

export type HandlerFn<K extends EventRoutingKey> = (payload: EventPayload<K>) => Promise<void>;

@Injectable()
export class MessageConsumer {
  private readonly logger = new Logger(MessageConsumer.name);
  private readonly ex: ReturnType<typeof exchangeNames>;
  private readonly maxRetries: number;
  private readonly idempotencyTtl: number;

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly cache: CacheService,
    private readonly locks: LockService,
    config: ConfigService,
  ) {
    this.ex = exchangeNames(config.getOrThrow<string>('RABBITMQ_EXCHANGE'));
    this.maxRetries = config.getOrThrow<number>('RABBITMQ_MAX_RETRIES');
    this.idempotencyTtl = config.getOrThrow<number>('RABBITMQ_IDEMPOTENCY_TTL');
  }

  // Bọc 1 handler: validate → idempotency → xử lý → retry/DLQ. Trả void (ack) hoặc Nack(requeue).
  async handle<K extends EventRoutingKey>(
    params: { subscriber: string; routingKey: K },
    raw: unknown,
    amqpMsg: ConsumeMessage,
    fn: HandlerFn<K>,
  ): Promise<void | Nack> {
    const { subscriber, routingKey } = params;
    const messageId = amqpMsg.properties.messageId ?? 'unknown';
    const doneKey = `messaging:done:${messageId}`;

    // Đã xử lý xong trước đó → ack-skip.
    if (await this.cache.get(doneKey)) return;

    // Validate: sai schema = non-retryable → thẳng DLQ.
    let payload: EventPayload<K>;
    try {
      payload = EventContracts[routingKey].parse(raw) as EventPayload<K>;
    } catch (e) {
      if (e instanceof ZodError) {
        this.logger.warn(`[${routingKey}] payload sai schema → DLQ (msg=${messageId})`);
        return this.toDlqOrRequeue(routingKey, raw, amqpMsg, 'validation');
      }
      throw e;
    }

    // Lock chống xử lý song song cùng messageId.
    const lock = await this.locks.acquire(`messaging:lock:${messageId}`, PROCESSING_LOCK_TTL_MS);
    if (!lock) return new Nack(true);

    try {
      await fn(payload);
      await this.cache.set(doneKey, 1, this.idempotencyTtl); // chỉ set marker khi thành công
      return;
    } catch (err) {
      this.logger.error(
        `[${routingKey}] handler lỗi (msg=${messageId}): ${(err as Error).message}`,
      );
      const attempt = Number(amqpMsg.properties.headers?.[MessagingHeaders.ATTEMPT] ?? 0);
      if (attempt < this.maxRetries) {
        return this.toRetryOrRequeue(subscriber, routingKey, payload, amqpMsg, attempt, err);
      }
      return this.toDlqOrRequeue(routingKey, payload, amqpMsg, (err as Error).message);
    } finally {
      await lock.release();
    }
  }

  private async toRetryOrRequeue<K extends EventRoutingKey>(
    subscriber: string,
    routingKey: K,
    payload: EventPayload<K>,
    amqpMsg: ConsumeMessage,
    attempt: number,
    err: unknown,
  ): Promise<void | Nack> {
    const tier = Math.min(attempt, this.lastTier(routingKey));
    try {
      await this.amqp.publish(this.ex.retry, retryRoutingKey(subscriber, routingKey, tier), payload, {
        messageId: amqpMsg.properties.messageId,
        headers: {
          ...amqpMsg.properties.headers,
          [MessagingHeaders.ATTEMPT]: attempt + 1,
          [MessagingHeaders.ERROR]: (err as Error).message,
        },
      });
      return; // ack bản gốc
    } catch (pubErr) {
      this.logger.error(`republish retry FAIL → requeue: ${(pubErr as Error).message}`);
      return new Nack(true); // KHÔNG ack: tránh mất message
    }
  }

  private async toDlqOrRequeue(
    routingKey: string,
    payload: unknown,
    amqpMsg: ConsumeMessage,
    reason: string,
  ): Promise<void | Nack> {
    try {
      await this.amqp.publish(this.ex.dlx, routingKey, payload, {
        messageId: amqpMsg.properties.messageId,
        headers: {
          ...amqpMsg.properties.headers,
          [MessagingHeaders.ERROR]: reason,
          [MessagingHeaders.FAILED_AT]: new Date().toISOString(),
        },
      });
      return; // ack bản gốc
    } catch (pubErr) {
      this.logger.error(`publish DLQ FAIL → requeue: ${(pubErr as Error).message}`);
      return new Nack(true);
    }
  }

  // Tier cuối = số tier - 1. Lấy số tier từ env qua maxRetries không đủ → đọc lại độ dài.
  private lastTier(_routingKey: string): number {
    return this.maxRetries - 1 >= 0 ? this.maxRetries - 1 : 0;
  }
}
```

> Ghi chú: số tier dùng = `maxRetries` (mỗi attempt 1 tier; `RABBITMQ_RETRY_DELAYS_MS` nên có ≥ `maxRetries` phần tử). `lastTier` clamp khi attempt vượt số tier. Nếu muốn tách rời số tier khỏi maxRetries, inject thêm độ dài mảng delays — giữ đơn giản: cấu hình 2 biến này khớp nhau.

- [ ] **Step 4: Run (pass)**

Run: `pnpm test -- consume`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/consume.ts test/unit/core/messaging/consume.spec.ts
git commit -m "feat(messaging): MessageConsumer wrapper (validate, idempotency, retry/DLQ)"
```

---

### Task 13: Health indicator RabbitMQ + wire vào HealthController

**Files:**
- Create: `src/core/messaging/messaging.health.ts`
- Modify: `src/core/health/health.controller.ts`

- [ ] **Step 1: Implement health indicator**

`src/core/messaging/messaging.health.ts`:

```ts
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MessagingHealth {
  constructor(private readonly amqp: AmqpConnection) {}

  // golevelup quản managed connection; `connected` phản ánh trạng thái hiện tại.
  status(): 'up' | 'down' {
    return this.amqp.connected ? 'up' : 'down';
  }
}
```

> Nếu Task 1 cho thấy thuộc tính tên khác (vd `managedConnection.isConnected()`): đổi `this.amqp.connected` cho khớp.

- [ ] **Step 2: Wire vào HealthController (optional inject — worker & API đều có MessagingModule)**

Sửa `src/core/health/health.controller.ts`:

```ts
import { Public } from '@common/decorators/public.decorator';
import { Temporal } from '@js-temporal/polyfill';
import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { MessagingHealth } from '@core/messaging/messaging.health';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ApiHealthCheck, ApiHealthController } from './decorators/health-api.decorator';

@ApiHealthController()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly messaging: MessagingHealth,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiHealthCheck()
  async check() {
    return {
      status: 'ok',
      timestamp: Temporal.Now.instant().toString(),
      redis: await this.pingRedis(),
      rabbitmq: this.messaging.status(),
    };
  }

  private async pingRedis(): Promise<'up' | 'down'> {
    const timeout = new Promise<'down'>((resolve) => setTimeout(() => resolve('down'), 500));
    const ping = this.redis
      .ping()
      .then((r): 'up' | 'down' => (r === 'PONG' ? 'up' : 'down'))
      .catch(() => 'down' as const);
    return Promise.race([ping, timeout]);
  }
}
```

- [ ] **Step 3: Export MessagingHealth từ MessagingModule**

Trong `src/core/messaging/messaging.module.ts`, thêm `MessagingHealth` vào `providers` và `exports` (import ở đầu file). `providers: [EventPublisherService, MessagingHealth]`, `exports: [EventPublisherService, MessagingHealth, RabbitMQModule]`.

- [ ] **Step 4: Verify (build tới sau khi app.module/worker.module nạp MessagingModule — tạm typecheck file)**

Run: `pnpm check`
Expected: format/lint PASS. (Build đầy đủ verify ở Phase 5.)

- [ ] **Step 5: Commit**

```bash
git add src/core/messaging/messaging.health.ts src/core/health/health.controller.ts src/core/messaging/messaging.module.ts
git commit -m "feat(messaging): health indicator rabbitmq + /health"
```

---

### Task 14: Unrouted consumer (alert message lọt AE)

**Files:**
- Create: `src/core/messaging/unrouted.consumer.ts`

- [ ] **Step 1: Implement**

`src/core/messaging/unrouted.consumer.ts`:

```ts
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';

// Chạy ở worker. Bắt message không khớp binding nào (qua alternate-exchange).
// queue đã được assert tập trung (topology.ts) → chỉ attach consumer.
@Injectable()
export class UnroutedConsumer {
  private readonly logger = new Logger(UnroutedConsumer.name);

  @RabbitSubscribe({
    queue: `${process.env.RABBITMQ_EXCHANGE ?? 'app'}.unrouted.q`,
    createQueueIfNotExists: false,
  })
  handle(msg: unknown, amqpMsg: ConsumeMessage): void {
    this.logger.error(
      `Unrouted message rk=${amqpMsg.fields.routingKey} msg=${amqpMsg.properties.messageId} — thiếu binding/cấu hình sai`,
    );
  }
}
```

> `@RabbitSubscribe` cần giá trị tĩnh lúc decorate → đọc `process.env` (đã được validate bởi CoreConfigModule; fallback `app` khớp default). Pattern này giống cách worker đọc env lúc decorate (`mailWorkerConcurrency`).

- [ ] **Step 2: Verify**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/core/messaging/unrouted.consumer.ts
git commit -m "feat(messaging): unrouted consumer (alert qua alternate-exchange)"
```

---

## Phase 3 — Outbox

### Task 15: Outbox repository port + Prisma impl

**Files:**
- Create: `src/core/outbox/outbox.repository.port.ts`
- Create: `src/core/outbox/outbox.repository.prisma.ts`

- [ ] **Step 1: Viết PORT**

`src/core/outbox/outbox.repository.port.ts`:

```ts
import type { EventPayload, EventRoutingKey } from '@core/messaging/messaging.contracts';
import type { OutboxEvent } from '@generated/prisma/client';

export type { OutboxEvent };

export type EnqueueOutboxData<K extends EventRoutingKey = EventRoutingKey> = {
  routingKey: K;
  payload: EventPayload<K>;
  messageId?: string;
  requestId?: string;
};

export abstract class OutboxRepository {
  // Ghi event PENDING — gọi BÊN TRONG TransactionManager.run để atomic với write nghiệp vụ.
  abstract enqueue(data: EnqueueOutboxData): Promise<OutboxEvent>;
  // Lấy & khoá batch PENDING tới hạn (FOR UPDATE SKIP LOCKED) trong 1 transaction.
  abstract claimPending(limit: number): Promise<OutboxEvent[]>;
  abstract markPublished(id: string): Promise<void>;
  abstract markFailed(id: string, retryDelayMs: number, maxAttempts: number): Promise<void>;
}
```

- [ ] **Step 2: Viết IMPL**

`src/core/outbox/outbox.repository.prisma.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { PrismaService } from '@core/prisma/prisma.service';
import { Prisma, type OutboxEvent } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import {
  type EnqueueOutboxData,
  OutboxRepository,
} from './outbox.repository.port';

@Injectable()
export class PrismaOutboxRepository extends OutboxRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  enqueue(data: EnqueueOutboxData): Promise<OutboxEvent> {
    return this.prisma.db.outboxEvent.create({
      data: {
        messageId: data.messageId ?? randomUUID(),
        routingKey: data.routingKey,
        payload: data.payload as Prisma.InputJsonValue,
        requestId: data.requestId,
      },
    });
  }

  // Khoá hàng PENDING tới hạn để nhiều relay không publish trùng.
  claimPending(limit: number): Promise<OutboxEvent[]> {
    return this.prisma.db.$queryRaw<OutboxEvent[]>`
      SELECT * FROM "OutboxEvent"
      WHERE "status" = 'PENDING' AND "availableAt" <= now()
      ORDER BY "createdAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    `;
  }

  async markPublished(id: string): Promise<void> {
    await this.prisma.db.outboxEvent.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
  }

  async markFailed(id: string, retryDelayMs: number, maxAttempts: number): Promise<void> {
    const row = await this.prisma.db.outboxEvent.update({
      where: { id },
      data: { attempts: { increment: 1 }, availableAt: new Date(Date.now() + retryDelayMs) },
    });
    if (row.attempts >= maxAttempts) {
      await this.prisma.db.outboxEvent.update({ where: { id }, data: { status: 'FAILED' } });
    }
  }
}
```

> `claimPending` dùng `$queryRaw` để có `FOR UPDATE SKIP LOCKED` (Prisma không hỗ trợ trực tiếp). Relay sẽ gọi nó trong `TransactionManager.run` để khoá có hiệu lực.

- [ ] **Step 3: Verify typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/core/outbox/outbox.repository.port.ts src/core/outbox/outbox.repository.prisma.ts
git commit -m "feat(outbox): repository port + Prisma impl (enqueue/claim/mark)"
```

---

### Task 16: OutboxRelay (worker) + OutboxModule

**Files:**
- Create: `src/core/outbox/outbox-relay.service.ts`
- Create: `src/core/outbox/outbox.module.ts`
- Test: `test/unit/core/outbox/outbox-relay.service.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { EventPublisherService } from '@core/messaging/event-publisher.service';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import { OutboxRelayService } from '@core/outbox/outbox-relay.service';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

describe('OutboxRelayService', () => {
  let relay: OutboxRelayService;
  const repo = { enqueue: jest.fn(), claimPending: jest.fn(), markPublished: jest.fn(), markFailed: jest.fn() };
  const publisher = { publish: jest.fn() };
  const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
  const config = {
    getOrThrow: jest.fn((k: string) =>
      ({ RABBITMQ_OUTBOX_POLL_MS: 1000, RABBITMQ_OUTBOX_BATCH: 50, RABBITMQ_OUTBOX_MAX_ATTEMPTS: 10 })[k],
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: OutboxRepository, useValue: repo },
        { provide: EventPublisherService, useValue: publisher },
        { provide: TransactionManager, useValue: tx },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    relay = moduleRef.get(OutboxRelayService);
  });

  it('drain: publish thành công → markPublished', async () => {
    repo.claimPending.mockResolvedValue([
      { id: 'o1', messageId: 'm1', routingKey: 'user.registered', payload: { userId: 'u', email: 'a@b.com' }, requestId: 'r1' },
    ]);
    publisher.publish.mockResolvedValue(undefined);
    await relay.drainOnce();
    expect(publisher.publish).toHaveBeenCalledWith(
      'user.registered',
      { userId: 'u', email: 'a@b.com' },
      { messageId: 'm1', requestId: 'r1' },
    );
    expect(repo.markPublished).toHaveBeenCalledWith('o1');
  });

  it('publish lỗi → markFailed với delay', async () => {
    repo.claimPending.mockResolvedValue([
      { id: 'o2', messageId: 'm2', routingKey: 'user.registered', payload: { userId: 'u', email: 'a@b.com' }, requestId: null },
    ]);
    publisher.publish.mockRejectedValue(new Error('broker down'));
    await relay.drainOnce();
    expect(repo.markFailed).toHaveBeenCalledWith('o2', expect.any(Number), 10);
    expect(repo.markPublished).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- outbox-relay`
Expected: FAIL.

- [ ] **Step 3: Implement service**

`src/core/outbox/outbox-relay.service.ts`:

```ts
import { EventPublisherService } from '@core/messaging/event-publisher.service';
import type { EventPayload, EventRoutingKey } from '@core/messaging/messaging.contracts';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxRepository } from './outbox.repository.port';

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pollMs: number;
  private readonly batch: number;
  private readonly maxAttempts: number;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly repo: OutboxRepository,
    private readonly publisher: EventPublisherService,
    private readonly tx: TransactionManager,
    config: ConfigService,
  ) {
    this.pollMs = config.getOrThrow<number>('RABBITMQ_OUTBOX_POLL_MS');
    this.batch = config.getOrThrow<number>('RABBITMQ_OUTBOX_BATCH');
    this.maxAttempts = config.getOrThrow<number>('RABBITMQ_OUTBOX_MAX_ATTEMPTS');
  }

  onApplicationBootstrap(): void {
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        await this.drainOnce();
      } catch (e) {
        this.logger.error(`outbox drain lỗi: ${(e as Error).message}`);
      } finally {
        this.scheduleNext();
      }
    }, this.pollMs);
  }

  // Khoá + xử lý 1 batch. Mỗi batch nằm trong 1 transaction để FOR UPDATE SKIP LOCKED có hiệu lực.
  async drainOnce(): Promise<void> {
    await this.tx.run(async () => {
      const rows = await this.repo.claimPending(this.batch);
      for (const row of rows) {
        try {
          await this.publisher.publish(
            row.routingKey as EventRoutingKey,
            row.payload as EventPayload<EventRoutingKey>,
            { messageId: row.messageId, requestId: row.requestId ?? undefined },
          );
          await this.repo.markPublished(row.id);
        } catch (e) {
          this.logger.error(`publish outbox ${row.id} lỗi: ${(e as Error).message}`);
          await this.repo.markFailed(row.id, this.pollMs * 5, this.maxAttempts);
        }
      }
    });
  }
}
```

- [ ] **Step 4: Implement module**

`src/core/outbox/outbox.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { OutboxRelayService } from './outbox-relay.service';
import { OutboxRepository } from './outbox.repository.port';
import { PrismaOutboxRepository } from './outbox.repository.prisma';

// forFeature: producer (API) chỉ cần OutboxRepository. withRelay: worker chạy thêm relay.
@Module({})
export class OutboxModule {
  static forProducer() {
    return {
      module: OutboxModule,
      providers: [{ provide: OutboxRepository, useClass: PrismaOutboxRepository }],
      exports: [OutboxRepository],
    };
  }

  static withRelay() {
    return {
      module: OutboxModule,
      providers: [
        { provide: OutboxRepository, useClass: PrismaOutboxRepository },
        OutboxRelayService,
      ],
      exports: [OutboxRepository],
    };
  }
}
```

- [ ] **Step 5: Run (pass) + typecheck**

Run: `pnpm test -- outbox-relay && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/outbox/outbox-relay.service.ts src/core/outbox/outbox.module.ts test/unit/core/outbox/outbox-relay.service.spec.ts
git commit -m "feat(outbox): relay (poll→publish→mark) + OutboxModule forProducer/withRelay"
```

---

## Phase 4 — Feature events

### Task 17: Notifications producer (rewrite controller, bỏ EventPattern)

**Files:**
- Modify: `src/modules/notifications/controllers/notifications.controller.ts`
- Modify: `src/modules/notifications/notifications.module.ts`

- [ ] **Step 1: Rewrite controller (publish trực tiếp qua EventPublisherService)**

`src/modules/notifications/controllers/notifications.controller.ts`:

```ts
import { Public } from '@common/decorators/public.decorator';
import { EventPublisherService } from '@core/messaging/event-publisher.service';
import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiNotificationPublish,
  ApiNotificationsController,
} from '../decorators/notifications-api.decorator';

@ApiNotificationsController()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly events: EventPublisherService) {}

  // Event rời (không gắn DB) → publish trực tiếp. Demo producer.
  @Public()
  @Post('publish')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiNotificationPublish()
  async publish() {
    await this.events.publish('notification.created', {
      userId: 'demo',
      message: 'hello from http',
    });
    return { published: true };
  }
}
```

- [ ] **Step 2: Module (không providers thêm; MessagingModule là @Global nên EventPublisherService có sẵn)**

`src/modules/notifications/notifications.module.ts` giữ:

```ts
import { Module } from '@nestjs/common';
import { NotificationsController } from './controllers/notifications.controller';

@Module({
  controllers: [NotificationsController],
})
export class NotificationsModule {}
```

- [ ] **Step 3: Verify**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/notifications/controllers/notifications.controller.ts src/modules/notifications/notifications.module.ts
git commit -m "refactor(notifications): publish qua EventPublisherService, bỏ @EventPattern"
```

---

### Task 18: Notifications consumer (worker)

**Files:**
- Create: `src/modules/notifications/consumers/notifications.consumer.ts`
- Create: `src/modules/notifications/notifications-consumer.module.ts`

- [ ] **Step 1: Implement consumer**

`src/modules/notifications/consumers/notifications.consumer.ts`:

```ts
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { MessageConsumer } from '@core/messaging/consume';
import type { NotificationCreated } from '@core/messaging/messaging.contracts';
import { Injectable, Logger } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';

const BASE = process.env.RABBITMQ_EXCHANGE ?? 'app';

@Injectable()
export class NotificationsConsumer {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(private readonly consumer: MessageConsumer) {}

  // Subscriber 'notifications' nghe 'notification.created'. Queue assert tập trung → chỉ attach.
  @RabbitSubscribe({
    queue: `notifications.notification.created.q`,
    createQueueIfNotExists: false,
  })
  handle(msg: unknown, amqpMsg: ConsumeMessage) {
    return this.consumer.handle(
      { subscriber: 'notifications', routingKey: 'notification.created' },
      msg,
      amqpMsg,
      async (payload: NotificationCreated) => {
        this.logger.log(`notification.created user=${payload.userId}: ${payload.message}`);
      },
    );
  }
}
```

> `BASE` giữ để nhất quán nếu cần đổi tên; queue name khớp `workQueueName('notifications','notification.created')`.

- [ ] **Step 2: Implement module**

`src/modules/notifications/notifications-consumer.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MessageConsumer } from '@core/messaging/consume';
import { NotificationsConsumer } from './consumers/notifications.consumer';

// Phía worker: MessagingModule (@Global) cung cấp AmqpConnection; Redis (@Global) cho idempotency.
@Module({
  providers: [MessageConsumer, NotificationsConsumer],
})
export class NotificationsConsumerModule {}
```

- [ ] **Step 3: Verify**

Run: `pnpm check`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/modules/notifications/consumers/notifications.consumer.ts src/modules/notifications/notifications-consumer.module.ts
git commit -m "feat(notifications): consumer worker (@RabbitSubscribe + MessageConsumer)"
```

---

### Task 19: Tách MailProducerModule + jobId=messageId

**Files:**
- Create: `src/modules/mail/mail.producer.module.ts`
- Modify: `src/modules/mail/jobs/mail.producer.ts`
- Modify: `src/modules/mail/mail.module.ts`

- [ ] **Step 1: Producer nhận jobId tuỳ chọn (dedup tầng BullMQ)**

Sửa `src/modules/mail/jobs/mail.producer.ts` method `enqueue`:

```ts
  async enqueue(data: SendMailJob, jobId?: string): Promise<string> {
    const job = await this.queue.add('send', data, {
      jobId, // = messageId → BullMQ bỏ trùng nếu enqueue lại cùng id
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
    return job.id as string;
  }
```

- [ ] **Step 2: Tạo module producer-only (không controller)**

`src/modules/mail/mail.producer.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailProducer } from './jobs/mail.producer';

// Chỉ producer + queue — KHÔNG controller (để worker import mà không lộ route HTTP mail).
@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  providers: [MailProducer],
  exports: [MailProducer],
})
export class MailProducerModule {}
```

- [ ] **Step 3: mail.module.ts (API) import lại MailProducerModule**

`src/modules/mail/mail.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { MailController } from './controllers/mail.controller';
import { MailProducerModule } from './mail.producer.module';

@Module({
  imports: [MailProducerModule],
  controllers: [MailController],
  exports: [MailProducerModule],
})
export class MailModule {}
```

- [ ] **Step 4: Verify**

Run: `pnpm check && pnpm typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/mail/mail.producer.module.ts src/modules/mail/jobs/mail.producer.ts src/modules/mail/mail.module.ts
git commit -m "refactor(mail): tách MailProducerModule (no controller) + jobId dedup"
```

---

### Task 20: user.registered — publish qua outbox trong transaction

**Files:**
- Modify: `src/modules/auth/services/auth.service.ts`
- Modify: `src/modules/auth/auth.module.ts`
- Test: `test/unit/modules/auth/services/auth.service.spec.ts`

- [ ] **Step 1: Viết/cập nhật test fail**

`test/unit/modules/auth/services/auth.service.spec.ts` (tạo mới nếu chưa có):

```ts
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import { AuthService } from '@modules/auth/services/auth.service';
import { UsersService } from '@modules/users/services/users.service';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';

describe('AuthService.register', () => {
  let service: AuthService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn() };
  const outbox = { enqueue: jest.fn() };
  const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
        { provide: OutboxRepository, useValue: outbox },
        { provide: TransactionManager, useValue: tx },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('tạo user và enqueue outbox user.registered trong cùng transaction', async () => {
    users.findByEmail.mockResolvedValue(null);
    const created = { id: '11111111-1111-1111-1111-111111111111', email: 'a@b.com', name: 'A' };
    users.create.mockResolvedValue(created);

    const result = await service.register({ email: 'a@b.com', password: 'secret12', name: 'A' });

    expect(tx.run).toHaveBeenCalledTimes(1);
    expect(users.create).toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledWith({
      routingKey: 'user.registered',
      payload: { userId: created.id, email: created.email, name: created.name },
    });
    expect(result).toBe(created);
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- auth.service`
Expected: FAIL.

- [ ] **Step 3: Implement service**

Sửa `src/modules/auth/services/auth.service.ts`:

```ts
import { AppException } from '@common/exceptions/app.exception';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import { UsersService } from '@modules/users/services/users.service';
import { HttpStatus, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthMessage } from '../auth.messages';
import type { LoginDto } from '../dto/login.dto';
import type { RegisterDto } from '../dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly outbox: OutboxRepository,
    private readonly tx: TransactionManager,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new AppException(AuthMessage.EMAIL_TAKEN, HttpStatus.CONFLICT);
    }
    const password = await bcrypt.hash(dto.password, 10);
    // User + outbox event atomic: relay ở worker sẽ publish user.registered.
    return this.tx.run(async () => {
      const user = await this.users.create({ email: dto.email, password, name: dto.name });
      await this.outbox.enqueue({
        routingKey: 'user.registered',
        payload: { userId: user.id, email: user.email, name: user.name ?? undefined },
      });
      return user;
    });
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new AppException(AuthMessage.INVALID_CREDENTIALS, HttpStatus.UNAUTHORIZED);
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken };
  }
}
```

- [ ] **Step 4: Wire AuthModule**

Sửa `src/modules/auth/auth.module.ts`: thêm `imports: [OutboxModule.forProducer(), ...]` (giữ các import hiện có như UsersModule, JwtModule). TransactionManager đến từ PrismaModule (@Global) nên không cần import lại; nếu AuthModule chưa thấy → thêm `PrismaModule` vào imports.

```ts
// thêm vào đầu file:
import { OutboxModule } from '@core/outbox/outbox.module';
// trong @Module imports: [..., OutboxModule.forProducer()]
```

- [ ] **Step 5: Run (pass)**

Run: `pnpm test -- auth.service && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/auth/services/auth.service.ts src/modules/auth/auth.module.ts test/unit/modules/auth/services/auth.service.spec.ts
git commit -m "feat(auth): publish user.registered qua transactional outbox khi register"
```

---

### Task 21: user.registered consumer (worker → enqueue mail)

**Files:**
- Create: `src/modules/users/consumers/user-registered.consumer.ts`
- Create: `src/modules/users/users-consumer.module.ts`
- Test: `test/unit/modules/users/consumers/user-registered.consumer.spec.ts`

- [ ] **Step 1: Viết test fail**

```ts
import { MessageConsumer } from '@core/messaging/consume';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import { UserRegisteredConsumer } from '@modules/users/consumers/user-registered.consumer';
import { Test } from '@nestjs/testing';

describe('UserRegisteredConsumer', () => {
  let consumer: UserRegisteredConsumer;
  const mail = { enqueue: jest.fn() };
  // MessageConsumer giả: gọi thẳng handler với payload để test logic enqueue mail.
  const messageConsumer = {
    handle: jest.fn((_p, payload, _m, fn) => fn(payload)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserRegisteredConsumer,
        { provide: MailProducer, useValue: mail },
        { provide: MessageConsumer, useValue: messageConsumer },
      ],
    }).compile();
    consumer = moduleRef.get(UserRegisteredConsumer);
  });

  it('enqueue mail với jobId=messageId', async () => {
    const payload = { userId: 'u1', email: 'a@b.com', name: 'A' };
    const amqpMsg = { properties: { messageId: 'mid-9', headers: {} } } as never;
    await consumer.handle(payload, amqpMsg);
    expect(mail.enqueue).toHaveBeenCalledWith(
      { to: 'a@b.com', subject: expect.any(String), body: expect.any(String) },
      'mid-9',
    );
  });
});
```

- [ ] **Step 2: Run (fail)**

Run: `pnpm test -- user-registered.consumer`
Expected: FAIL.

- [ ] **Step 3: Implement consumer**

`src/modules/users/consumers/user-registered.consumer.ts`:

```ts
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { MessageConsumer } from '@core/messaging/consume';
import type { UserRegistered } from '@core/messaging/messaging.contracts';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import { Injectable } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';

@Injectable()
export class UserRegisteredConsumer {
  constructor(
    private readonly consumer: MessageConsumer,
    private readonly mail: MailProducer,
  ) {}

  // Subscriber 'mail' nghe 'user.registered' → enqueue BullMQ mail job (chuỗi RMQ → BullMQ).
  @RabbitSubscribe({
    queue: `mail.user.registered.q`,
    createQueueIfNotExists: false,
  })
  handle(msg: unknown, amqpMsg: ConsumeMessage) {
    const messageId = amqpMsg.properties.messageId;
    return this.consumer.handle(
      { subscriber: 'mail', routingKey: 'user.registered' },
      msg,
      amqpMsg,
      async (payload: UserRegistered) => {
        await this.mail.enqueue(
          {
            to: payload.email,
            subject: 'Chào mừng!',
            body: `Xin chào ${payload.name ?? payload.email}, tài khoản của bạn đã sẵn sàng.`,
          },
          messageId,
        );
      },
    );
  }
}
```

- [ ] **Step 4: Implement module**

`src/modules/users/users-consumer.module.ts`:

```ts
import { MessageConsumer } from '@core/messaging/consume';
import { MailProducerModule } from '@modules/mail/mail.producer.module';
import { Module } from '@nestjs/common';
import { UserRegisteredConsumer } from './consumers/user-registered.consumer';

// Phía worker: cần MailProducer để enqueue job. MessagingModule/Redis là @Global.
@Module({
  imports: [MailProducerModule],
  providers: [MessageConsumer, UserRegisteredConsumer],
})
export class UsersConsumerModule {}
```

- [ ] **Step 5: Run (pass)**

Run: `pnpm test -- user-registered.consumer && pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/modules/users/consumers/user-registered.consumer.ts src/modules/users/users-consumer.module.ts test/unit/modules/users/consumers/user-registered.consumer.spec.ts
git commit -m "feat(users): consumer user.registered → enqueue mail (worker)"
```

---

## Phase 5 — Bootstrap, wiring, cleanup

### Task 22: API bootstrap — bỏ microservice, nạp MessagingModule (producer)

**Files:**
- Modify: `src/main.ts`
- Modify: `src/app.module.ts`

- [ ] **Step 1: main.ts — xoá connectMicroservice/startAllMicroservices + import microservices**

Trong `src/main.ts`: xoá dòng `import { type MicroserviceOptions, Transport } from '@nestjs/microservices';`, xoá block `app.connectMicroservice<...>({...})` (dòng 38–48) và dòng `await app.startAllMicroservices();`. Giữ nguyên phần còn lại (Swagger, listen, shutdown hooks).

- [ ] **Step 2: app.module.ts — thay MessagingModule cũ + OutboxModule.forProducer**

Trong `src/app.module.ts`: bỏ `import { MessagingModule } from './core/messaging/messaging.module';` cũ (RMQ_CLIENT) đã bị thay; thêm:

```ts
import { MessagingModule } from './core/messaging/messaging.module';
import { OutboxModule } from './core/outbox/outbox.module';
// trong imports:
//   MessagingModule.forRoot({ consumer: false }),
//   OutboxModule.forProducer(),
```

Thay entry `MessagingModule` cũ trong mảng `imports` bằng `MessagingModule.forRoot({ consumer: false })` và thêm `OutboxModule.forProducer()`. Giữ `NotificationsModule`.

- [ ] **Step 3: Verify build API**

Run: `pnpm build`
Expected: PASS (compile `main` + `main.worker`).

- [ ] **Step 4: Commit**

```bash
git add src/main.ts src/app.module.ts
git commit -m "feat(api): bỏ microservice RMQ; nạp MessagingModule(producer)+OutboxModule"
```

---

### Task 23: Worker bootstrap — nạp Prisma/Messaging/Outbox/consumers

**Files:**
- Modify: `src/worker.module.ts`

- [ ] **Step 1: Cập nhật WorkerModule**

`src/worker.module.ts`:

```ts
import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { CoreConfigModule } from '@core/config/config.module';
import { HealthController } from '@core/health/health.controller';
import { LoggerModule } from '@core/logger/logger.module';
import { MessagingModule } from '@core/messaging/messaging.module';
import { UnroutedConsumer } from '@core/messaging/unrouted.consumer';
import { OutboxModule } from '@core/outbox/outbox.module';
import { PrismaModule } from '@core/prisma/prisma.module';
import { QueueModule } from '@core/queue/queue.module';
import { RedisModule } from '@core/redis/redis.module';
import { MailWorkerModule } from '@modules/mail/mail-worker.module';
import { NotificationsConsumerModule } from '@modules/notifications/notifications-consumer.module';
import { UsersConsumerModule } from '@modules/users/users-consumer.module';
import { Module } from '@nestjs/common';

// Worker process: chạy BullMQ processors + RMQ consumers + outbox relay.
// KHÁC trước: nay CÓ PrismaModule (outbox/consumers cần DB) + MessagingModule (consumer mode).
@Module({
  imports: [
    CoreConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    MessagingModule.forRoot({ consumer: true }),
    OutboxModule.withRelay(),
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter }),
    MailWorkerModule,
    NotificationsConsumerModule,
    UsersConsumerModule,
  ],
  controllers: [HealthController],
  providers: [UnroutedConsumer],
})
export class WorkerModule {}
```

- [ ] **Step 2: Verify build**

Run: `pnpm build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/worker.module.ts
git commit -m "feat(worker): nạp Prisma+Messaging(consumer)+Outbox relay+RMQ consumers"
```

---

### Task 24: Cleanup `@nestjs/microservices` + messaging cũ

**Files:**
- Delete (nếu còn): old `RMQ_CLIENT` artifacts
- Modify: `package.json`

- [ ] **Step 1: Tìm tham chiếu còn lại tới microservices/RMQ_CLIENT**

Run: `grep -rn "@nestjs/microservices\|RMQ_CLIENT\|EventPattern\|ClientProxy\|RABBITMQ_QUEUE" src test`
Expected: KHÔNG còn kết quả (mọi nơi đã chuyển). Nếu còn → sửa nốt.

- [ ] **Step 2: Gỡ package nếu sạch tham chiếu**

Run: `pnpm remove @nestjs/microservices`
Expected: gỡ khỏi dependencies.

- [ ] **Step 3: Verify build + toàn bộ test**

Run: `pnpm build && pnpm test`
Expected: PASS toàn bộ.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: gỡ @nestjs/microservices (RMQ chuyển sang golevelup)"
```

---

### Task 25: Cập nhật CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Cập nhật các mục mô tả RabbitMQ/worker**

Sửa trong `CLAUDE.md`:
- Bảng Stack dòng Queue/Messaging: "RabbitMQ qua **`@golevelup/nestjs-rabbitmq`** (topology quorum + DLX + retry-tier + alternate-exchange); producer ở API, consumer + outbox relay ở **worker**".
- Mục "Worker process": bỏ câu "KHÔNG import PrismaModule/MessagingModule"; thay bằng: worker NAY import `PrismaModule` + `MessagingModule.forRoot({consumer:true})` + `OutboxModule.withRelay()` + các `*-consumer.module.ts`.
- Thêm mục con "RabbitMQ / Messaging": producer-only ở API, event gắn-DB qua **transactional outbox** (`AuthService.register`), consumer per-subscription `<subscriber>.<event>.q`, retry tiered backoff, idempotency lock+marker, contract Zod ở `messaging.contracts.ts`, topology tập trung `topology.ts`. Thêm event = thêm dòng trong `SUBSCRIPTIONS` + handler.

- [ ] **Step 2: Verify lint markdown (không bắt buộc) + commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): cập nhật kiến trúc RabbitMQ golevelup + outbox + worker"
```

---

### Task 26: Smoke test thủ công (manual verification)

**Files:** none (chạy hệ thống)

- [ ] **Step 1: Bật hạ tầng**

Đảm bảo RabbitMQ (≥3.8), Postgres, Redis chạy (vd `docker compose up -d` nếu có). Migration đã chạy ở Task 3.

- [ ] **Step 2: Chạy API + worker**

Run (2 terminal): `pnpm start:dev` và `pnpm start:worker:dev`
Expected: cả hai boot; log worker thấy connect RabbitMQ; `GET http://localhost:3000/health` và `:3001/health` trả `rabbitmq: 'up'`.

- [ ] **Step 3: Test luồng user.registered → mail**

Run: `curl -X POST http://localhost:3000/auth/register -H 'content-type: application/json' -d '{"email":"smoke@test.com","password":"secret12","name":"Smoke"}'`
Expected: 2xx; log worker: OutboxRelay publish `user.registered` → UserRegisteredConsumer nhận → MailProducer enqueue → MailProcessor xử lý "send". Bull Board `:3001/admin/queues` thấy job mail.

- [ ] **Step 4: Test retry/DLQ (tùy chọn)**

Tạm ném lỗi trong `MailProcessor` hoặc consumer để quan sát message đi qua `app.retry` → quay lại → sau `RABBITMQ_MAX_RETRIES` vào `mail.user.registered.dlq` (xem RabbitMQ management UI). Hoàn tác sau khi xác nhận.

- [ ] **Step 5: Commit (nếu có chỉnh khi smoke)**

```bash
git add -A && git commit -m "test: smoke verification RabbitMQ messaging end-to-end" || echo "no changes"
```

---

## Self-review checklist (đã chạy khi viết plan)

- **Spec coverage:** golevelup (T1,T10), env (T2), outbox model (T3), tx context (T4–T6), constants/contracts/topology (T7–T9), publisher (T11), consumer wrapper retry/idempotency (T12), health (T13), unrouted/AE (T9,T14), outbox repo+relay (T15–T16), notifications producer/consumer (T17–T18), mail producer split+jobId (T19), user.registered outbox+consumer (T20–T21), bootstrap API/worker (T22–T23), cleanup microservices (T24), docs (T25), smoke (T26). Mọi mục §3–§15 của spec có task tương ứng.
- **Placeholder scan:** không có TBD/TODO; mọi step code có nội dung thật. Các điểm phụ-thuộc-version golevelup đều có hướng fallback cụ thể (T1 verify, T9/T11/T13 ghi chú).
- **Type consistency:** `EventRoutingKey`/`EventPayload`/`EventContracts`/`SUBSCRIPTIONS` (T8) dùng nhất quán ở T9/T11/T12/T15/T16. `MessageConsumer.handle(params, raw, amqpMsg, fn)` (T12) khớp cách gọi ở T18/T21. `OutboxRepository.enqueue({routingKey,payload,...})` (T15) khớp T20. `prisma.db` (T4) khớp T6/T15. `TransactionManager.run` (T5) khớp T16/T20.
