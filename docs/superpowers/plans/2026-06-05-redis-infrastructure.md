# Redis Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Thêm một module hạ tầng Redis dùng chung (`src/core/redis/`) cung cấp Cache, distributed Lock, RateLimit và Pub/Sub trên ioredis, dùng chung instance Redis với BullMQ.

**Architecture:** `RedisModule` `@Global` tạo hai ioredis connection (`REDIS_CLIENT` cho command thường + Lua, `REDIS_SUBSCRIBER` riêng cho pub/sub), đăng ký Lua script qua `defineCommand` lúc tạo client. Bốn service theo port pattern (abstract class = DI token, impl ioredis). Lock/RateLimit chạy atomic bằng Lua.

**Tech Stack:** NestJS 11, ioredis 5, Redis 8 (`redis:8-alpine` — chỉ dùng feature có sẵn từ Redis 6: `SET NX PX`, sorted set, `EVAL`; KHÔNG khóa cứng 8.4), Zod env, nestjs-i18n (message key cho lỗi lock), Jest + @swc/jest, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-05-redis-infrastructure-design.md`

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/core/redis/redis.constants.ts` | DI token `REDIS_CLIENT`, `REDIS_SUBSCRIBER` |
| `src/core/redis/redis.provider.ts` | `buildRedisBaseOptions()` + factory tạo client/subscriber + đăng ký Lua |
| `src/core/redis/scripts/acquire-lock.lua.ts` | Lua SET NX PX + INCR fencing |
| `src/core/redis/scripts/release-lock.lua.ts` | Lua compare-then-del |
| `src/core/redis/scripts/rate-limit.lua.ts` | Lua sliding-window log |
| `src/core/redis/redis.module.ts` | `@Global` wiring + `OnModuleDestroy` quit |
| `src/core/redis/redis.messages.ts` | i18n key `redis.LOCK_ACQUISITION_FAILED` |
| `src/core/redis/ports/cache.service.port.ts` | PORT CacheService |
| `src/core/redis/ports/lock.service.port.ts` | PORT LockService + `Lock` |
| `src/core/redis/ports/rate-limit.service.port.ts` | PORT RateLimitService + `RateLimitResult` |
| `src/core/redis/ports/pubsub.service.port.ts` | PORT PubSubService |
| `src/core/redis/services/cache.service.ts` | impl `RedisCacheService` |
| `src/core/redis/services/lock.service.ts` | impl `RedisLockService` |
| `src/core/redis/services/rate-limit.service.ts` | impl `RedisRateLimitService` |
| `src/core/redis/services/pubsub.service.ts` | impl `RedisPubSubService` |
| `src/core/config/env.schema.ts` | thêm 4 env Redis (modify) |
| `src/core/queue/queue.module.ts` | spread base options + `maxRetriesPerRequest: null` (modify) |
| `src/app.module.ts` | import `RedisModule` (modify) |
| `src/core/health/*` | thêm `redis: up/down` (modify) |
| `src/i18n/{vi,en}/redis.json` | bản dịch key lock |

---

## Task 1: Dependency, env & connection foundation

**Files:**
- Modify: `package.json` (thêm `ioredis`)
- Modify: `src/core/config/env.schema.ts`
- Create: `src/core/redis/redis.constants.ts`
- Create: `src/core/redis/redis.provider.ts`
- Test: `test/unit/core/redis/redis.provider.spec.ts`

- [ ] **Step 1: Cài ioredis**

Run: `pnpm add ioredis`
Expected: `package.json` `dependencies` có `"ioredis": "^5.x"`, `require.resolve('ioredis')` không còn `MODULE_NOT_FOUND`.

- [ ] **Step 2: Thêm env Redis** — sửa `src/core/config/env.schema.ts`, ngay dưới dòng `REDIS_PORT`:

```ts
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_KEY_PREFIX: z.string().default('app:'),
  CACHE_DEFAULT_TTL: z.coerce.number().int().positive().default(60), // giây
```

- [ ] **Step 3: Tạo token** — `src/core/redis/redis.constants.ts`:

```ts
// DI token cho hai ioredis connection. Symbol để không đụng string token khác.
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');
```

- [ ] **Step 4: Viết test thất bại cho `buildRedisBaseOptions`** — `test/unit/core/redis/redis.provider.spec.ts`:

```ts
import { buildRedisBaseOptions } from '@core/redis/redis.provider';

function fakeConfig(values: Record<string, unknown>) {
  return {
    getOrThrow: (k: string) => values[k],
    get: (k: string) => values[k],
  } as any;
}

describe('buildRedisBaseOptions', () => {
  it('maps host/port/password/db từ config', () => {
    const opts = buildRedisBaseOptions(
      fakeConfig({ REDIS_HOST: 'h', REDIS_PORT: 6379, REDIS_PASSWORD: 'pw', REDIS_DB: 2 }),
    );
    expect(opts).toEqual({ host: 'h', port: 6379, password: 'pw', db: 2 });
  });

  it('db mặc định 0 khi config trả undefined', () => {
    const opts = buildRedisBaseOptions(fakeConfig({ REDIS_HOST: 'h', REDIS_PORT: 6379 }));
    expect(opts.db).toBe(0);
    expect(opts.password).toBeUndefined();
  });
});
```

- [ ] **Step 5: Chạy test, xác nhận FAIL**

Run: `pnpm jest test/unit/core/redis/redis.provider.spec.ts`
Expected: FAIL — `Cannot find module '@core/redis/redis.provider'`.

- [ ] **Step 6: Viết `redis.provider.ts`**

```ts
import type { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';
import { acquireLock } from './scripts/acquire-lock.lua';
import { rateLimit } from './scripts/rate-limit.lua';
import { releaseLock } from './scripts/release-lock.lua';

// Connection identity dùng chung cho CẢ app client lẫn BullMQ. KHÔNG chứa keyPrefix
// (ioredis prepend vào mọi command → sẽ đổi layout key BullMQ) và KHÔNG chứa
// maxRetriesPerRequest (BullMQ tự set null). Mỗi consumer spread rồi thêm phần riêng.
export function buildRedisBaseOptions(config: ConfigService): RedisOptions {
  return {
    host: config.getOrThrow<string>('REDIS_HOST'),
    port: config.getOrThrow<number>('REDIS_PORT'),
    password: config.get<string>('REDIS_PASSWORD'),
    db: config.get<number>('REDIS_DB') ?? 0,
  };
}

function appOptions(config: ConfigService): RedisOptions {
  return {
    ...buildRedisBaseOptions(config),
    keyPrefix: config.get<string>('REDIS_KEY_PREFIX') ?? 'app:',
    lazyConnect: true,
    retryStrategy: (times) => Math.min(times * 200, 2000),
  };
}

// Client chính: chạy command thường + Lua (đăng ký sẵn qua defineCommand).
export function createRedisClient(config: ConfigService): Redis {
  const client = new Redis(appOptions(config));
  client.defineCommand('acquireLock', acquireLock);
  client.defineCommand('releaseLock', releaseLock);
  client.defineCommand('rateLimit', rateLimit);
  return client;
}

// Subscriber riêng: vào subscriber mode nên không dùng cho command thường.
export function createRedisSubscriber(config: ConfigService): Redis {
  return new Redis({ ...appOptions(config), maxRetriesPerRequest: null });
}
```

> Lưu ý: `createRedisClient`/`createRedisSubscriber` import `./scripts/*` — các file đó được tạo ở Task 3 & 4. Để Task 1 build/test được ngay, tạo trước 3 file script **rỗng tạm** bằng Step 7. Lua thật điền ở Task 3/4.

- [ ] **Step 7: Tạo stub script tạm** (điền Lua thật ở Task 3/4)

`src/core/redis/scripts/acquire-lock.lua.ts`:
```ts
export const acquireLock = { numberOfKeys: 2, lua: 'return redis.error_reply("not implemented")' };
```
`src/core/redis/scripts/release-lock.lua.ts`:
```ts
export const releaseLock = { numberOfKeys: 1, lua: 'return redis.error_reply("not implemented")' };
```
`src/core/redis/scripts/rate-limit.lua.ts`:
```ts
export const rateLimit = { numberOfKeys: 1, lua: 'return redis.error_reply("not implemented")' };
```

- [ ] **Step 8: Chạy test, xác nhận PASS**

Run: `pnpm jest test/unit/core/redis/redis.provider.spec.ts`
Expected: PASS (2 test).

- [ ] **Step 9: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/config/env.schema.ts src/core/redis test/unit/core/redis/redis.provider.spec.ts
git commit -m "feat(redis): thêm ioredis + env + connection base options"
```

---

## Task 2: RedisModule wiring + đồng bộ BullMQ + bật vào app

**Files:**
- Create: `src/core/redis/redis.module.ts`
- Modify: `src/core/queue/queue.module.ts`
- Modify: `src/app.module.ts`
- Modify: `src/main.ts` (đảm bảo `enableShutdownHooks`)

- [ ] **Step 1: Tạo `redis.module.ts`** (chưa có service nào — sẽ thêm provider ở Task 3-6)

```ts
import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';
import { createRedisClient, createRedisSubscriber } from './redis.provider';

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [ConfigService], useFactory: createRedisClient },
    { provide: REDIS_SUBSCRIBER, inject: [ConfigService], useFactory: createRedisSubscriber },
  ],
  exports: [REDIS_CLIENT, REDIS_SUBSCRIBER],
})
export class RedisModule implements OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {}

  // Graceful shutdown: nhả connection (cần app.enableShutdownHooks() ở main.ts).
  async onModuleDestroy(): Promise<void> {
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }
}
```

- [ ] **Step 2: Đồng bộ BullMQ** — sửa `src/core/queue/queue.module.ts`:

```ts
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRedisBaseOptions } from '../redis/redis.provider';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Spread connection identity dùng chung (host/port/password/db). KHÔNG set
        // maxRetriesPerRequest: BullMQ tự ép null cho connection nó own (cần cho blocking
        // command của Worker) — set lại là thừa. KHÔNG áp keyPrefix của app (BullMQ có
        // cơ chế prefix riêng → tránh đổi layout key).
        connection: { ...buildRedisBaseOptions(config) },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

> **Lưu ý (pre-existing, out-of-scope):** vì BullMQ dùng `maxRetriesPerRequest: null` cho connection của nó (offline queue bật), HTTP producer `MailController.test` → `queue.add` có thể **treo request khi Redis down** thay vì lỗi nhanh. Hành vi này đã có từ trước (code cũ chỉ truyền host/port nhưng BullMQ vẫn ép null), plan này không làm tệ hơn. Nếu sau cần producer fail-fast: tạo connection producer riêng với `enableOfflineQueue: false`. Không làm ở phạm vi này (endpoint mail chỉ là demo `@Public`).

- [ ] **Step 3: Import `RedisModule` vào app** — sửa `src/app.module.ts`: thêm import và đặt vào mảng `imports` ngay sau `QueueModule`:

```ts
import { RedisModule } from './core/redis/redis.module';
// ...
    QueueModule,
    RedisModule,
    MessagingModule,
```

- [ ] **Step 4: Đảm bảo shutdown hooks** — mở `src/main.ts`, xác nhận có `app.enableShutdownHooks()`. Nếu chưa có, thêm trước `await app.listen(...)`:

```ts
  app.enableShutdownHooks();
```

- [ ] **Step 5: Build + boot kiểm tra**

Run: `docker compose up -d redis && pnpm build`
Expected: build PASS. Sau đó `pnpm start:dev` boot không lỗi (Redis localhost:6379 — nếu chạy qua docker-compose dùng port 6380 thì set `REDIS_PORT=6380` trong `.env`). BullMQ vẫn khởi tạo bình thường.

- [ ] **Step 6: Commit**

```bash
git add src/core/redis/redis.module.ts src/core/queue/queue.module.ts src/app.module.ts src/main.ts
git commit -m "feat(redis): RedisModule global + đồng bộ connection BullMQ"
```

---

## Task 3: CacheService (port + impl)

**Files:**
- Create: `src/core/redis/ports/cache.service.port.ts`
- Create: `src/core/redis/services/cache.service.ts`
- Modify: `src/core/redis/redis.module.ts` (wire provider)
- Test: `test/unit/core/redis/services/cache.service.spec.ts`

- [ ] **Step 1: Tạo PORT** — `src/core/redis/ports/cache.service.port.ts`:

```ts
// PORT cache-aside. abstract class = DI token + type. Impl: services/cache.service.ts.
export abstract class CacheService {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  // miss → chạy factory → cache. Một GET phân biệt được: miss = JS null, null-đã-cache = chuỗi 'null'.
  abstract getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
}
```

- [ ] **Step 2: Viết test thất bại** — `test/unit/core/redis/services/cache.service.spec.ts`:

```ts
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { CacheService } from '@core/redis/ports/cache.service.port';
import { RedisCacheService } from '@core/redis/services/cache.service';

describe('RedisCacheService', () => {
  const client = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(60) };
  let service: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CacheService, useClass: RedisCacheService },
        { provide: REDIS_CLIENT, useValue: client },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(CacheService);
  });

  it('get trả null khi miss', async () => {
    client.get.mockResolvedValue(null);
    expect(await service.get('k')).toBeNull();
    expect(client.get).toHaveBeenCalledWith('cache:k');
  });

  it('get parse JSON khi hit', async () => {
    client.get.mockResolvedValue('{"a":1}');
    expect(await service.get('k')).toEqual({ a: 1 });
  });

  it('set dùng TTL truyền vào (EX)', async () => {
    await service.set('k', { a: 1 }, 30);
    expect(client.set).toHaveBeenCalledWith('cache:k', '{"a":1}', 'EX', 30);
  });

  it('set dùng CACHE_DEFAULT_TTL khi không truyền ttl', async () => {
    await service.set('k', 1);
    expect(client.set).toHaveBeenCalledWith('cache:k', '1', 'EX', 60);
  });

  it('getOrSet gọi factory đúng 1 lần khi miss (GET trả null) rồi cache', async () => {
    client.get.mockResolvedValue(null);
    const factory = jest.fn().mockResolvedValue({ v: 9 });
    const out = await service.getOrSet('k', 30, factory);
    expect(out).toEqual({ v: 9 });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith('cache:k', '{"v":9}', 'EX', 30);
  });

  it('getOrSet KHÔNG gọi factory khi hit null-đã-cache (GET trả chuỗi "null")', async () => {
    client.get.mockResolvedValue('null');
    const factory = jest.fn();
    const out = await service.getOrSet('k', 30, factory);
    expect(out).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `pnpm jest test/unit/core/redis/services/cache.service.spec.ts`
Expected: FAIL — `Cannot find module '@core/redis/services/cache.service'`.

- [ ] **Step 4: Viết impl** — `src/core/redis/services/cache.service.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis.constants';
import { CacheService } from '../ports/cache.service.port';

@Injectable()
export class RedisCacheService extends CacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly config: ConfigService,
  ) {
    super();
  }

  private key(key: string): string {
    return `cache:${key}`;
  }

  private ttl(ttlSeconds?: number): number {
    return ttlSeconds ?? this.config.get<number>('CACHE_DEFAULT_TTL') ?? 60;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.client.set(this.key(key), JSON.stringify(value), 'EX', this.ttl(ttlSeconds));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const full = this.key(key);
    // Một GET, không race: miss = JS null; null-đã-cache = chuỗi 'null' → parse ra null (hit).
    const raw = await this.client.get(full);
    if (raw !== null) return JSON.parse(raw) as T;
    const value = await factory();
    await this.client.set(full, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  }
}
```

- [ ] **Step 5: Wire vào module** — sửa `src/core/redis/redis.module.ts`: thêm import + provider + export:

```ts
import { CacheService } from './ports/cache.service.port';
import { RedisCacheService } from './services/cache.service';
// trong providers: thêm
    { provide: CacheService, useClass: RedisCacheService },
// trong exports: thêm
    CacheService,
```

- [ ] **Step 6: Chạy test + typecheck, xác nhận PASS**

Run: `pnpm jest test/unit/core/redis/services/cache.service.spec.ts && pnpm typecheck`
Expected: PASS (6 test), typecheck sạch.

- [ ] **Step 7: Commit**

```bash
git add src/core/redis/ports/cache.service.port.ts src/core/redis/services/cache.service.ts src/core/redis/redis.module.ts test/unit/core/redis/services/cache.service.spec.ts
git commit -m "feat(redis): CacheService cache-aside (port + ioredis impl)"
```

---

## Task 4: LockService + i18n message + Lua thật

**Files:**
- Create: `src/i18n/vi/redis.json`, `src/i18n/en/redis.json`
- Create: `src/core/redis/redis.messages.ts`
- Modify: `src/core/redis/scripts/acquire-lock.lua.ts`, `release-lock.lua.ts` (Lua thật)
- Create: `src/core/redis/ports/lock.service.port.ts`
- Create: `src/core/redis/services/lock.service.ts`
- Modify: `src/core/redis/redis.module.ts`
- Test: `test/unit/core/redis/services/lock.service.spec.ts`

- [ ] **Step 1: Thêm bản dịch** — `src/i18n/vi/redis.json`:

```json
{
  "LOCK_ACQUISITION_FAILED": "Không thể chiếm khóa, tài nguyên đang bận"
}
```
`src/i18n/en/redis.json`:
```json
{
  "LOCK_ACQUISITION_FAILED": "Could not acquire lock, resource is busy"
}
```

- [ ] **Step 2: Sinh lại type i18n**

Run: `pnpm i18n:gen`
Expected: `src/generated/i18n.generated.ts` `I18nPath` có `'redis.LOCK_ACQUISITION_FAILED'`.

- [ ] **Step 3: Tạo message map** — `src/core/redis/redis.messages.ts`:

```ts
import type { I18nPath } from '@generated/i18n.generated';

// Khóa i18n cho module redis (typo bị bắt lúc compile qua satisfies).
export const RedisMessage = {
  LOCK_ACQUISITION_FAILED: 'redis.LOCK_ACQUISITION_FAILED',
} as const satisfies Record<string, I18nPath>;
```

- [ ] **Step 4: Điền Lua thật** — `src/core/redis/scripts/acquire-lock.lua.ts`:

```ts
// KEYS[1]=lock:<key>, KEYS[2]=lock:fence:<key>; ARGV[1]=token, ARGV[2]=ttlMs.
// Atomic: SET NX PX rồi INCR fencing — trả fencingToken (số) khi giữ được, false (→ null) khi đã bị giữ.
export const acquireLock = {
  numberOfKeys: 2,
  lua: `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", tonumber(ARGV[2])) then
  return redis.call("incr", KEYS[2])
else
  return false
end`,
};
```
`src/core/redis/scripts/release-lock.lua.ts`:
```ts
// KEYS[1]=lock:<key>; ARGV[1]=token. Chỉ del khi token khớp (compare-then-del). Trả 1 hoặc 0.
// (Redis 8.4+ có `DELEX key IFEQ token` native; cố ý giữ Lua để chạy trên Redis 6/7/8 — xem spec §5.2/§7.)
export const releaseLock = {
  numberOfKeys: 1,
  lua: `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`,
};
```

- [ ] **Step 5: Tạo PORT** — `src/core/redis/ports/lock.service.port.ts`:

```ts
export interface Lock {
  key: string;
  token: string; // giá trị random nhận diện chủ lock (dùng khi release)
  fencingToken: number; // counter tăng dần — caller so cũ/mới để chặn ghi đè
  release(): Promise<boolean>;
}

export abstract class LockService {
  abstract acquire(key: string, ttlMs: number): Promise<Lock | null>;
  abstract withLock<T>(key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>): Promise<T>;
}
```

- [ ] **Step 6: Viết test thất bại** — `test/unit/core/redis/services/lock.service.spec.ts`:

```ts
import { AppException } from '@common/exceptions/app.exception';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { LockService } from '@core/redis/ports/lock.service.port';
import { RedisLockService } from '@core/redis/services/lock.service';

describe('RedisLockService', () => {
  const client = { acquireLock: jest.fn(), releaseLock: jest.fn() };
  let service: LockService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: LockService, useClass: RedisLockService },
        { provide: REDIS_CLIENT, useValue: client },
      ],
    }).compile();
    service = moduleRef.get(LockService);
  });

  it('acquire trả Lock kèm fencingToken khi script trả số', async () => {
    client.acquireLock.mockResolvedValue(7);
    const lock = await service.acquire('job', 5000);
    expect(lock).toMatchObject({ key: 'job', fencingToken: 7 });
    expect(typeof lock?.token).toBe('string');
    // KEYS: lock:<key>, lock:fence:<key>; ARGV: token, ttl
    expect(client.acquireLock).toHaveBeenCalledWith(
      'lock:job',
      'lock:fence:job',
      expect.any(String),
      5000,
    );
  });

  it('acquire trả null khi script trả null (đã bị giữ)', async () => {
    client.acquireLock.mockResolvedValue(null);
    expect(await service.acquire('job', 5000)).toBeNull();
  });

  it('release del đúng token, trả true khi script trả 1', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.release()).toBe(true);
    expect(client.releaseLock).toHaveBeenCalledWith('lock:job', lock?.token);
  });

  it('release trả false khi script trả 0 (token lệch)', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(0);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.release()).toBe(false);
  });

  it('withLock chạy fn rồi release', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    const out = await service.withLock('job', 5000, async () => 'done');
    expect(out).toBe('done');
    expect(client.releaseLock).toHaveBeenCalled();
  });

  it('withLock release kể cả khi fn ném', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    await expect(
      service.withLock('job', 5000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(client.releaseLock).toHaveBeenCalled();
  });

  it('withLock ném AppException(409) khi không acquire được', async () => {
    client.acquireLock.mockResolvedValue(null);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toBeInstanceOf(AppException);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 7: Chạy test, xác nhận FAIL**

Run: `pnpm jest test/unit/core/redis/services/lock.service.spec.ts`
Expected: FAIL — `Cannot find module '@core/redis/services/lock.service'`.

- [ ] **Step 8: Viết impl** — `src/core/redis/services/lock.service.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { AppException } from '@common/exceptions/app.exception';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis.constants';
import { RedisMessage } from '../redis.messages';
import { type Lock, LockService } from '../ports/lock.service.port';

@Injectable()
export class RedisLockService extends LockService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    super();
  }

  async acquire(key: string, ttlMs: number): Promise<Lock | null> {
    const token = randomBytes(20).toString('hex');
    // Lua tự đăng ký qua defineCommand → gọi như command thường (cast any: custom command).
    const fencingToken: number | null = await (this.client as any).acquireLock(
      `lock:${key}`,
      `lock:fence:${key}`,
      token,
      ttlMs,
    );
    if (fencingToken === null) return null;
    return {
      key,
      token,
      fencingToken,
      release: async () => (await (this.client as any).releaseLock(`lock:${key}`, token)) === 1,
    };
  }

  async withLock<T>(key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>): Promise<T> {
    const lock = await this.acquire(key, ttlMs);
    if (!lock) {
      throw new AppException(RedisMessage.LOCK_ACQUISITION_FAILED, HttpStatus.CONFLICT);
    }
    try {
      return await fn(lock);
    } finally {
      await lock.release();
    }
  }
}
```

- [ ] **Step 9: Wire vào module** — sửa `src/core/redis/redis.module.ts`: thêm

```ts
import { LockService } from './ports/lock.service.port';
import { RedisLockService } from './services/lock.service';
// providers: thêm { provide: LockService, useClass: RedisLockService },
// exports: thêm LockService,
```

- [ ] **Step 10: Chạy test + typecheck, xác nhận PASS**

Run: `pnpm jest test/unit/core/redis/services/lock.service.spec.ts && pnpm typecheck`
Expected: PASS (7 test), typecheck sạch.

- [ ] **Step 11: Commit**

```bash
git add src/i18n src/core/redis test/unit/core/redis/services/lock.service.spec.ts
git commit -m "feat(redis): LockService Redlock 1-node + fencing + Lua atomic"
```

---

## Task 5: RateLimitService + Lua sliding-window

**Files:**
- Modify: `src/core/redis/scripts/rate-limit.lua.ts` (Lua thật)
- Create: `src/core/redis/ports/rate-limit.service.port.ts`
- Create: `src/core/redis/services/rate-limit.service.ts`
- Modify: `src/core/redis/redis.module.ts`
- Test: `test/unit/core/redis/services/rate-limit.service.spec.ts`

- [ ] **Step 1: Điền Lua thật** — `src/core/redis/scripts/rate-limit.lua.ts`:

```ts
// KEYS[1]=rl:<key>; ARGV[1]=now(ms), ARGV[2]=window(ms), ARGV[3]=limit, ARGV[4]=member(unique).
// Sliding-window log atomic. Trả { allowed(0/1), remaining, oldest(ms) }.
// oldest = score entry sớm nhất còn trong cửa sổ (sau cleanup); rỗng → now. Caller tính
// resetAt = oldest + window (thời điểm slot sớm nhất rời cửa sổ — đúng cho request bị từ chối).
export const rateLimit = {
  numberOfKeys: 1,
  lua: `
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
redis.call("zremrangebyscore", KEYS[1], 0, now - window)
local count = redis.call("zcard", KEYS[1])
local allowed = 0
if count < limit then
  redis.call("zadd", KEYS[1], now, ARGV[4])
  redis.call("pexpire", KEYS[1], window)
  count = count + 1
  allowed = 1
end
local remaining = limit - count
if remaining < 0 then remaining = 0 end
local oldest = now
local first = redis.call("zrange", KEYS[1], 0, 0, "WITHSCORES")
if first[2] then oldest = tonumber(first[2]) end
return { allowed, remaining, oldest }`,
};
```

- [ ] **Step 2: Tạo PORT** — `src/core/redis/ports/rate-limit.service.port.ts`:

```ts
export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number; // epoch ms slot sớm nhất rời cửa sổ = oldest_hit + window
}

export abstract class RateLimitService {
  abstract hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
```

- [ ] **Step 3: Viết test thất bại** — `test/unit/core/redis/services/rate-limit.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { RateLimitService } from '@core/redis/ports/rate-limit.service.port';
import { RedisRateLimitService } from '@core/redis/services/rate-limit.service';

describe('RedisRateLimitService', () => {
  const client = { rateLimit: jest.fn() };
  let service: RateLimitService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: RateLimitService, useClass: RedisRateLimitService },
        { provide: REDIS_CLIENT, useValue: client },
      ],
    }).compile();
    service = moduleRef.get(RateLimitService);
  });

  it('dưới ngưỡng → allowed=true, remaining từ Lua, resetAt = oldest + window', async () => {
    // oldest = now (vừa add) → resetAt = now + window
    client.rateLimit.mockResolvedValue([1, 4, 1_000_000]);
    const res = await service.hit('login:ip', 5, 60);
    expect(res).toEqual({ allowed: true, remaining: 4, resetAt: 1_000_000 + 60_000 });
    // KEYS rl:<key>; ARGV now, window(ms), limit, member
    expect(client.rateLimit).toHaveBeenCalledWith(
      'rl:login:ip',
      1_000_000,
      60_000,
      5,
      expect.any(String),
    );
  });

  it('bị từ chối → allowed=false, resetAt = oldest_hit + window (sớm hơn now+window)', async () => {
    // oldest = 980_000 → slot sớm nhất rời cửa sổ lúc 980_000 + 60_000 = 1_040_000
    client.rateLimit.mockResolvedValue([0, 0, 980_000]);
    const res = await service.hit('login:ip', 5, 60);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.resetAt).toBe(1_040_000);
  });
});
```

- [ ] **Step 4: Chạy test, xác nhận FAIL**

Run: `pnpm jest test/unit/core/redis/services/rate-limit.service.spec.ts`
Expected: FAIL — `Cannot find module '@core/redis/services/rate-limit.service'`.

- [ ] **Step 5: Viết impl** — `src/core/redis/services/rate-limit.service.ts`:

```ts
import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis.constants';
import { type RateLimitResult, RateLimitService } from '../ports/rate-limit.service.port';

@Injectable()
export class RedisRateLimitService extends RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    super();
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const [allowed, remaining, oldest]: [number, number, number] = await (
      this.client as any
    ).rateLimit(`rl:${key}`, now, windowMs, limit, `${now}:${randomUUID()}`);
    return { allowed: allowed === 1, remaining, resetAt: oldest + windowMs };
  }
}
```

- [ ] **Step 6: Wire vào module** — sửa `src/core/redis/redis.module.ts`: thêm

```ts
import { RateLimitService } from './ports/rate-limit.service.port';
import { RedisRateLimitService } from './services/rate-limit.service';
// providers: thêm { provide: RateLimitService, useClass: RedisRateLimitService },
// exports: thêm RateLimitService,
```

- [ ] **Step 7: Chạy test + typecheck, xác nhận PASS**

Run: `pnpm jest test/unit/core/redis/services/rate-limit.service.spec.ts && pnpm typecheck`
Expected: PASS (2 test), typecheck sạch.

- [ ] **Step 8: Commit**

```bash
git add src/core/redis test/unit/core/redis/services/rate-limit.service.spec.ts
git commit -m "feat(redis): RateLimitService sliding-window Lua atomic"
```

---

## Task 6: PubSubService

**Files:**
- Create: `src/core/redis/ports/pubsub.service.port.ts`
- Create: `src/core/redis/services/pubsub.service.ts`
- Modify: `src/core/redis/redis.module.ts`
- Test: `test/unit/core/redis/services/pubsub.service.spec.ts`

- [ ] **Step 1: Tạo PORT** — `src/core/redis/ports/pubsub.service.port.ts`:

```ts
export abstract class PubSubService {
  abstract publish<T>(channel: string, message: T): Promise<void>;
  abstract subscribe<T>(channel: string, handler: (message: T) => void): Promise<void>;
  abstract unsubscribe(channel: string): Promise<void>;
}
```

- [ ] **Step 2: Viết test thất bại** — `test/unit/core/redis/services/pubsub.service.spec.ts`:

```ts
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '@core/redis/redis.constants';
import { PubSubService } from '@core/redis/ports/pubsub.service.port';
import { RedisPubSubService } from '@core/redis/services/pubsub.service';

describe('RedisPubSubService', () => {
  const client = { publish: jest.fn() };
  // subscriber là EventEmitter giả: ghi lại handler 'message' để bắn thủ công.
  let messageHandler: (channel: string, payload: string) => void = () => {};
  const subscriber = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event: string, cb: any) => {
      if (event === 'message') messageHandler = cb;
    }),
  };
  let service: PubSubService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PubSubService, useClass: RedisPubSubService },
        { provide: REDIS_CLIENT, useValue: client },
        { provide: REDIS_SUBSCRIBER, useValue: subscriber },
      ],
    }).compile();
    // .compile() KHÔNG chạy lifecycle hook; .init() mới gọi onModuleInit (đăng ký listener 'message').
    await moduleRef.init();
    service = moduleRef.get(PubSubService);
  });

  it('publish gửi JSON qua client', async () => {
    await service.publish('events', { a: 1 });
    expect(client.publish).toHaveBeenCalledWith('events', '{"a":1}');
  });

  it('subscribe đăng ký channel và dispatch handler với message parse', async () => {
    const handler = jest.fn();
    await service.subscribe('events', handler);
    expect(subscriber.subscribe).toHaveBeenCalledWith('events');
    // mô phỏng message tới
    messageHandler('events', '{"a":2}');
    expect(handler).toHaveBeenCalledWith({ a: 2 });
  });

  it('không dispatch handler của channel khác', async () => {
    const handler = jest.fn();
    await service.subscribe('events', handler);
    messageHandler('other', '{"a":3}');
    expect(handler).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Chạy test, xác nhận FAIL**

Run: `pnpm jest test/unit/core/redis/services/pubsub.service.spec.ts`
Expected: FAIL — `Cannot find module '@core/redis/services/pubsub.service'`.

- [ ] **Step 4: Viết impl** — `src/core/redis/services/pubsub.service.ts`:

```ts
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '../redis.constants';
import { PubSubService } from '../ports/pubsub.service.port';

@Injectable()
export class RedisPubSubService extends PubSubService implements OnModuleInit {
  // channel → danh sách handler. Một listener 'message' duy nhất phân phối theo channel.
  private readonly handlers = new Map<string, Array<(message: any) => void>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {
    super();
  }

  onModuleInit(): void {
    this.subscriber.on('message', (channel: string, payload: string) => {
      const list = this.handlers.get(channel);
      if (!list) return;
      const message = JSON.parse(payload);
      for (const handler of list) handler(message);
    });
  }

  async publish<T>(channel: string, message: T): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe<T>(channel: string, handler: (message: T) => void): Promise<void> {
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.push(handler as (message: any) => void);
      return;
    }
    this.handlers.set(channel, [handler as (message: any) => void]);
    await this.subscriber.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);
    await this.subscriber.unsubscribe(channel);
  }
}
```

- [ ] **Step 5: Wire vào module** — sửa `src/core/redis/redis.module.ts`: thêm

```ts
import { PubSubService } from './ports/pubsub.service.port';
import { RedisPubSubService } from './services/pubsub.service';
// providers: thêm { provide: PubSubService, useClass: RedisPubSubService },
// exports: thêm PubSubService,
```

- [ ] **Step 6: Chạy test + typecheck, xác nhận PASS**

Run: `pnpm jest test/unit/core/redis/services/pubsub.service.spec.ts && pnpm typecheck`
Expected: PASS (3 test), typecheck sạch.

- [ ] **Step 7: Commit**

```bash
git add src/core/redis test/unit/core/redis/services/pubsub.service.spec.ts
git commit -m "feat(redis): PubSubService publish/subscribe connection riêng"
```

---

## Task 7: Health check Redis

**Files:**
- Modify: `src/core/health/dto/health-response.dto.ts`
- Modify: `src/core/health/health.controller.ts`

- [ ] **Step 1: Thêm field `redis` vào DTO** — sửa `src/core/health/dto/health-response.dto.ts`:

```ts
export const healthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
  redis: z.enum(['up', 'down']),
});
```

- [ ] **Step 2: Ping Redis trong controller** — sửa `src/core/health/health.controller.ts`:

```ts
import { Public } from '@common/decorators/public.decorator';
import { Temporal } from '@js-temporal/polyfill';
import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ApiHealthCheck, ApiHealthController } from './decorators/health-api.decorator';

@ApiHealthController()
@Controller('health')
export class HealthController {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiHealthCheck()
  async check() {
    return {
      status: 'ok',
      timestamp: Temporal.Now.instant().toString(),
      redis: await this.pingRedis(),
    };
  }

  // ping() có thể treo: lazyConnect + offline queue khiến lệnh chờ/retry khi Redis chưa sẵn sàng.
  // Race với timeout ngắn → trả 'down' thay vì giữ request. (Liveness check không được block.)
  private async pingRedis(): Promise<'up' | 'down'> {
    const timeout = new Promise<'down'>((resolve) => setTimeout(() => resolve('down'), 500));
    const ping = this.redis
      .ping()
      .then((r) => (r === 'PONG' ? 'up' : 'down') as const)
      .catch(() => 'down' as const);
    return Promise.race([ping, timeout]);
  }
}
```

- [ ] **Step 3: Build + boot kiểm tra thủ công**

Run: `docker compose up -d redis && pnpm start:dev`
Expected: `GET /health` trả `{ status: 'ok', timestamp, redis: 'up' }`. Tắt Redis → `redis: 'down'`, route vẫn 200.

- [ ] **Step 4: Commit**

```bash
git add src/core/health
git commit -m "feat(health): thêm trạng thái Redis vào GET /health"
```

---

## Task 8: Toàn bộ verify + cập nhật CLAUDE.md

**Files:**
- Modify: `CLAUDE.md` (mục cấu trúc + ghi chú Redis)

- [ ] **Step 1: Chạy verify đầy đủ**

Run: `pnpm verify`
Expected: i18n:gen + biome check + typecheck + build đều PASS.

- [ ] **Step 2: Chạy toàn bộ test**

Run: `pnpm test`
Expected: tất cả spec PASS (gồm 4 service redis + provider).

- [ ] **Step 3: Cập nhật CLAUDE.md** — trong sơ đồ cấu trúc `src/core/`, thêm dòng:

```
│   ├── redis/        # RedisModule @Global: Cache/Lock/RateLimit/PubSub (ioredis + port pattern)
```

Và thêm một mục ngắn dưới phần Convention mô tả: inject port (`CacheService`/`LockService`/`RateLimitService`/`PubSubService`), không inject `REDIS_CLIENT` trực tiếp trong module nghiệp vụ; lock/rate-limit chạy Lua atomic; pub/sub không thay RabbitMQ cho việc cần durable.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: ghi chú module redis vào CLAUDE.md"
```

---

## Self-Review

**Spec coverage:**

| Spec | Task |
|---|---|
| ioredis là direct dep | T1.1 |
| Env mới (password/db/keyPrefix/cache ttl) | T1.2 |
| `REDIS_CLIENT` / `REDIS_SUBSCRIBER` token + connection riêng | T1.3, T2.1 |
| `buildRedisBaseOptions` + đồng bộ BullMQ (maxRetriesPerRequest null, không keyPrefix) | T1.6, T2.2 |
| Lifecycle quit + enableShutdownHooks | T2.1, T2.4 |
| CacheService (get/set/del/getOrSet, một GET phân biệt miss/null-đã-cache) | T3 |
| LockService atomic acquire + fencing + Lua release + withLock 409 | T4 |
| i18n `redis.LOCK_ACQUISITION_FAILED` | T4.1–T4.3 |
| RateLimitService sliding-window Lua | T5 |
| PubSubService (publish client / subscribe subscriber) | T6 |
| Health Redis ping | T7 |
| Test plan mirror `test/unit/core/redis/` | T1, T3-T6 |
| Cập nhật CLAUDE.md | T8 |

**Type consistency:** `Lock` (key/token/fencingToken/release) đồng nhất T4 port↔impl↔test. `RateLimitResult` (allowed/remaining/resetAt) đồng nhất T5. Custom command `acquireLock`/`releaseLock`/`rateLimit` cùng tên ở `defineCommand` (T1.6), Lua (T4/T5) và lời gọi service (T4.8/T5.5). Tên class impl `Redis*Service` đồng nhất giữa file, wiring module và test.

**Placeholder scan:** Lua stub ở T1.7 là chủ ý (điền thật ở T4/T5) — không phải placeholder treo; mọi step khác có code đầy đủ.
