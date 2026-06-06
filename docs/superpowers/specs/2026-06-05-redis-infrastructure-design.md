# Hạ tầng Redis & các service liên quan — Design

- **Ngày:** 2026-06-05
- **Trạng thái:** Approved, sẵn sàng lập kế hoạch implement
- **Stack liên quan:** NestJS 11 + Fastify, ioredis, SWC builder, pnpm, BullMQ (đã dùng Redis sẵn)
- **Thư viện:** **thêm `ioredis@^5` vào `dependencies`** (client trực tiếp — KHÔNG thêm `redlock`, `@nestjs/throttler`, `cache-manager`). Lưu ý: `ioredis` hiện **không** resolve được ở top-level (`require.resolve('ioredis')` → `MODULE_NOT_FOUND`); BullMQ không expose bản transitive dùng được, nên đây là một dependency mới app phải khai báo, không phải "tái dùng client có sẵn".

## 1. Mục tiêu

Xây một module hạ tầng Redis dùng chung (`src/core/redis/`, `@Global`), cung cấp 4 năng lực qua các service chuyên trách, mỗi service theo **port pattern** (abstract class = DI token + type, ioredis = impl) để mock được trong test và đồng nhất triết lý repository của dự án:

1. **CacheService** — cache-aside (get / set / del / getOrSet) có TTL + namespace.
2. **LockService** — distributed lock (Redlock 1-node) an toàn: `SET NX PX` + Lua release + fencing token.
3. **RateLimitService** — giới hạn tần suất bằng sliding-window atomic qua Lua.
4. **PubSubService** — publish/subscribe real-time (connection subscriber riêng).

Dùng **cùng instance Redis** với BullMQ (`REDIS_HOST`/`REDIS_PORT` đã có trong `env.schema.ts` + `queue.module.ts`), phân tách logic bằng `keyPrefix`.

### Non-goals (YAGNI)

- **Không** Cluster/Sentinel — chỉ single-node (khớp `docker-compose.yml` hiện tại). Để mở rộng sau khi phát sinh nhu cầu.
- **Không** L1 (in-memory) + L2 cache nhiều tầng — chỉ cache-aside một tầng trên Redis.
- **Không** Redlock đa-node (multi-Redis quorum). Dùng biến thể 1-node + fencing token (đủ cho 1 instance Redis hiện có).
- **Không** dùng thư viện cộng đồng (`redlock`, `@nestjs/throttler`, `cache-manager`) — tự viết mỏng để giữ convention port pattern và kiểm soát hành vi.
- **Không** decorator `@Cacheable`/`@RateLimit` ở bản đầu — chỉ inject service trực tiếp. Thêm decorator khi có nhu cầu thực.
- **Không** idempotency / streams / metrics Prometheus ở bản đầu.

## 2. Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Use cases | Caching + Distributed lock + Rate limiting + Pub/Sub + Lua scripting (tất cả) |
| Client | `ioredis` trực tiếp, bọc trong service + **port pattern** (cùng client với BullMQ) |
| Phạm vi bàn giao | **Chỉ design spec** lần này (chưa code, chưa plan) |
| Topology | Single-node (không Cluster/Sentinel) |
| Lock | Redlock 1-node: `SET key <token> NX PX ttl`, release bằng Lua compare-then-del, kèm fencing token |
| Rate limit | Sliding-window atomic bằng Lua (`ZADD`/`ZREMRANGEBYSCORE`/`ZCARD`) |
| Pub/Sub | `REDIS_CLIENT` để publish, **`REDIS_SUBSCRIBER` connection riêng** để subscribe |
| Lua | Nạp qua `defineCommand` (ioredis tự cache script, dùng `EVALSHA` ngầm) |
| Serialize cache | JSON (`JSON.stringify`/`parse`); `get()` gộp miss và `null`-đã-cache thành `null`, chỉ `getOrSet` phân biệt qua một `GET` (miss=`null` vs `'null'`) |

### Vì sao ioredis trực tiếp thay vì thư viện cộng đồng

- BullMQ cũng nói chuyện với Redis qua ioredis → dùng `ioredis` cho app giữ **một phong cách connection duy nhất** trong codebase (dù vẫn phải khai báo `ioredis` là dependency trực tiếp — xem phần Thư viện ở trên).
- `ioredis.defineCommand` xử lý cache script + `EVALSHA` ngầm → Lua cho lock/rate-limit gọn và nhanh (nguồn: docs ioredis qua Context7).
- Port pattern (abstract class) cho phép mock từng service bằng `useValue` trong unit test — đúng convention CLAUDE.md, điều mà gói facade sẵn không cho.

## 3. Cấu trúc thư mục

```
src/core/redis/
├── redis.module.ts            # @Global; provide clients + 4 service port→impl; export ports
├── redis.constants.ts         # injection token: REDIS_CLIENT, REDIS_SUBSCRIBER
├── redis.provider.ts          # factory tạo ioredis từ ConfigService (options + lifecycle)
├── scripts/                   # Lua gom tập trung
│   ├── acquire-lock.lua.ts    # SET NX PX + INCR fencing (atomic)
│   ├── release-lock.lua.ts    # compare-value-then-del
│   └── rate-limit.lua.ts      # sliding-window atomic
├── ports/                     # abstract class = DI token + type (KHÔNG import ioredis)
│   ├── cache.service.port.ts
│   ├── lock.service.port.ts
│   ├── rate-limit.service.port.ts
│   └── pubsub.service.port.ts
└── services/                  # ioredis impl của port tương ứng
    ├── cache.service.ts
    ├── lock.service.ts
    ├── rate-limit.service.ts
    └── pubsub.service.ts
```

- Theo đúng layout `core/*` (như `prisma/`, `queue/`): hạ tầng, **không business logic**.
- Naming theo vai trò (giống repository port pattern): port = `*.service.port.ts`, impl ioredis = `*.service.ts`. Đổi backend khác (vd node-redis) → thêm impl mới, port không đổi.
- **Không** barrel `index.ts`. Import vượt module dùng alias `@core/redis/...`.

## 4. Connection (`redis.provider.ts` + `redis.constants.ts`)

Hai provider, cùng cấu hình host/port nhưng tách vai trò:

- **`REDIS_CLIENT`** — ioredis chính, chạy mọi command thường (cache, lock, rate-limit, publish).
- **`REDIS_SUBSCRIBER`** — ioredis riêng cho subscribe. Lý do: khi một connection vào *subscriber mode* nó **không chạy được lệnh thường** (giới hạn của ioredis/Redis — xác nhận qua docs ioredis). Pub publish và sub subscribe phải là hai connection.

```ts
// redis.constants.ts
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');
export const REDIS_SUBSCRIBER = Symbol('REDIS_SUBSCRIBER');
```

Factory đọc `ConfigService`, áp các option:

| Option | Giá trị | Lý do |
|---|---|---|
| `host` / `port` | `REDIS_HOST` / `REDIS_PORT` | Tái dùng env có sẵn (BullMQ dùng chung) |
| `password` | `REDIS_PASSWORD` (optional) | Prod có auth |
| `db` | `REDIS_DB` (default 0) | Tách DB nếu cần |
| `keyPrefix` | `REDIS_KEY_PREFIX` (default `app:`) | Namespace toàn cục, tránh đụng key BullMQ |
| `lazyConnect` | `true` | Kết nối khi lệnh đầu tiên; app boot không chết nếu Redis chậm |
| `maxRetriesPerRequest` | `null` cho subscriber, mặc định cho client | Subscriber không nên fail request theo retry |
| `retryStrategy` | backoff có trần (vd `min(times*200, 2000)`ms) | Tự reconnect khi Redis rớt |

- **Lifecycle**: provider có `onModuleDestroy` gọi `client.quit()` cho cả hai connection (graceful shutdown, flush command đang chờ).
- `RedisModule` `@Global()` → mọi module inject port mà không cần import lại (giống `PrismaModule`).

### Đồng bộ cấu hình với BullMQ (BẮT BUỘC)

`QueueModule` (`src/core/queue/queue.module.ts`) hiện chỉ truyền `host` + `port`:

```ts
connection: {
  host: config.getOrThrow('REDIS_HOST'),
  port: config.getOrThrow('REDIS_PORT'),
}
```

Khi thêm `REDIS_PASSWORD` / `REDIS_DB`, **phải cập nhật `QueueModule`** truyền đủ `password`, `db`, nếu không:

- Prod bật Redis auth → BullMQ kết nối **fail** (app Redis có password, BullMQ thì không).
- `REDIS_DB != 0` → app Redis và BullMQ **âm thầm dùng hai DB khác nhau**.

Cách làm: tách một hàm dùng chung chỉ trả **connection identity** — `buildRedisBaseOptions(config) → { host, port, password, db }` (trong `redis.provider.ts`). Mỗi consumer **spread base rồi tự thêm phần riêng**, KHÔNG dùng nguyên một options object cho cả hai vì:

- **BullMQ bắt buộc `maxRetriesPerRequest: null`** cho connection của nó (BullMQ cảnh báo/từ chối nếu khác) — chỉ BullMQ thêm field này.
- **`keyPrefix` KHÔNG đưa vào base**: ioredis `keyPrefix` prepend vào *mọi* command → nếu áp lên connection BullMQ, key BullMQ thành `app:bull:...`, đổi layout key (BullMQ có cơ chế `prefix` riêng). `keyPrefix` chỉ thêm cho `REDIS_CLIENT`/`REDIS_SUBSCRIBER` của app.

```ts
// redis.provider.ts — base dùng chung
export function buildRedisBaseOptions(config: ConfigService) {
  return {
    host: config.getOrThrow('REDIS_HOST'),
    port: config.getOrThrow('REDIS_PORT'),
    password: config.get('REDIS_PASSWORD'),     // undefined → không auth
    db: config.get('REDIS_DB') ?? 0,
  };
}
// App client:  { ...base, keyPrefix, lazyConnect: true, retryStrategy }
// BullMQ:      { ...base, maxRetriesPerRequest: null }
```

Đây là một task trong kế hoạch implement, không phải thay đổi rời rạc.

## 5. Bốn service (port → impl)

### 5.1 CacheService (cache-aside)

Port `cache.service.port.ts`:

```ts
export abstract class CacheService {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  abstract getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
}
```

- Namespace nội bộ `cache:` (cộng với `keyPrefix` toàn cục).
- Serialize JSON. `get()` **gộp** cache-miss và giá trị `null`-đã-cache thành cùng `null` trả về (giới hạn của kiểu `T | null` — caller cần phân biệt thì dùng `getOrSet`). `getOrSet` phân biệt bằng **một `GET`** (không race, không round-trip thừa): Redis miss → JS `null` → chạy `factory`; `null`-đã-cache → chuỗi `'null'` → parse ra `null`, tính là cache-hit (không chạy lại `factory`). Mặc định: không cache `undefined`, cache `null` được phép.
- `getOrSet`: miss → gọi `factory()` → `set` với TTL → trả. **KHÔNG** chống cache-stampede: nhiều request miss đồng thời sẽ cùng chạy `factory()`. Nếu sau này cần coalesce (chỉ một request build, số còn lại chờ), nâng cấp bằng `LockService` hoặc in-flight promise map — để dành (YAGNI), không làm ở bản đầu.
- TTL mặc định lấy từ `CACHE_DEFAULT_TTL` khi caller không truyền.

### 5.2 LockService (distributed lock)

Port:

```ts
export interface Lock {
  key: string;
  token: string;          // giá trị random nhận diện chủ lock (dùng khi release)
  fencingToken: number;   // counter tăng dần — caller so cũ/mới để chặn ghi đè
  release(): Promise<boolean>;
}

export abstract class LockService {
  abstract acquire(key: string, ttlMs: number): Promise<Lock | null>; // null nếu đã bị giữ
  abstract withLock<T>(key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>): Promise<T>;
}
```

- **Acquire atomic bằng MỘT Lua script** (`defineCommand` `acquireLock`): vừa `SET NX PX` vừa `INCR` fencing counter trong một lần gọi — tránh trường hợp `SET` thành công nhưng `INCR` rời sau đó fail → lock bị giữ mà không trả được fencing token:

  ```lua
  -- acquire-lock.lua  (KEYS[1]=lock:<key>, KEYS[2]=lock:fence:<key>; ARGV[1]=token, ARGV[2]=ttlMs)
  if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", tonumber(ARGV[2])) then
    return redis.call("incr", KEYS[2])   -- trả fencingToken khi giữ được lock
  else
    return nil                           -- đã bị giữ
  end
  ```

  `token` random 20 byte (crypto). Acquire trả `null` khi script trả `nil`. Fencing counter (`lock:fence:<key>`) **không** đặt TTL — nó monotonic theo khuyến nghị redis.io (TTL Redis không dùng monotonic clock).

- **Release an toàn** bằng Lua compare-then-del (tránh xóa nhầm lock người khác khi job chạy quá TTL) — `defineCommand` `releaseLock`.

  > **Redis 8.4+ có `DELEX key IFEQ <token>`** (compare-and-delete native, không cần Lua) — xem mục "Redis 8" phần 7. **Quyết định: vẫn dùng Lua release** vì (a) acquire BẮT BUỘC dùng Lua (atomic 2 key SET+INCR), giữ một cơ chế duy nhất; (b) Lua chạy trên Redis 6/7/8 → không khóa cứng minor `8.4`. Đổi sang `DELEX` chỉ tiết kiệm một script nhỏ mà thêm ràng buộc phiên bản.

  Lua release: 

  ```lua
  -- release-lock.lua  (KEYS[1]=lock:<key>; ARGV[1]=token)
  if redis.call("get", KEYS[1]) == ARGV[1] then
    return redis.call("del", KEYS[1])
  else
    return 0
  end
  ```
- **withLock** (hành vi đã chốt): acquire → nếu `null` thì **ném `AppException`** với key i18n typed, status `HttpStatus.CONFLICT` (409); nếu giữ được thì chạy `fn` trong `try`, `release()` trong `finally` (luôn nhả kể cả `fn` ném).
- **Message key bắt buộc thêm trước khi implement**: `AppException` nhận `I18nPath` (`src/common/exceptions/app.exception.ts`), mà `common.messages.ts` hiện chỉ có `INTERNAL_ERROR`, `VALIDATION_FAILED`. Theo pattern "mỗi module sở hữu một namespace i18n", tạo:
  - `src/core/redis/redis.messages.ts` → `export const RedisMessage = { LOCK_ACQUISITION_FAILED: 'redis.LOCK_ACQUISITION_FAILED' } as const satisfies Record<string, I18nPath>;`
  - `src/i18n/vi/redis.json` + `src/i18n/en/redis.json` với key `LOCK_ACQUISITION_FAILED`.
  - Chạy `pnpm i18n:gen` để `I18nPath` có key mới (nếu không, `redis.messages.ts` không typecheck).
- Phạm vi: **1-node**. Ghi rõ trong code đây không phải Redlock quorum đa-node.

### 5.3 RateLimitService

Port:

```ts
export interface RateLimitResult { allowed: boolean; remaining: number; resetAt: number; }

export abstract class RateLimitService {
  abstract hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
}
```

- Thuật toán **sliding-window log** atomic bằng Lua (một round-trip, không race):
  - `ZREMRANGEBYSCORE` xóa entry ngoài cửa sổ.
  - `ZCARD` đếm số hit còn lại.
  - Nếu `< limit`: `ZADD <now> <uniqueMember>` + `PEXPIRE`, `allowed = true`.
  - Nếu `>= limit`: `allowed = false`.
  - Trả `remaining`, `resetAt`.
- Key namespace `rl:<key>`. Caller tự dựng key (vd `rl:login:<ip>`).
- Để caller (guard/interceptor module nghiệp vụ) quyết định ném lỗi 429 — service chỉ trả kết quả.

### 5.4 PubSubService

Port:

```ts
export abstract class PubSubService {
  abstract publish<T>(channel: string, message: T): Promise<void>;
  abstract subscribe<T>(channel: string, handler: (message: T) => void): Promise<void>;
  abstract unsubscribe(channel: string): Promise<void>;
}
```

- `publish` qua `REDIS_CLIENT` (`JSON.stringify`).
- `subscribe` qua `REDIS_SUBSCRIBER`: `subscriber.subscribe(channel)` + lắng nghe event `message`, parse JSON, dispatch handler theo channel. Quản lý map `channel → handler[]` nội bộ.
- Lưu ý ranh giới: đây là pub/sub fire-and-forget; **không** thay RabbitMQ (`core/messaging`) cho công việc cần ack/durable.

## 6. Env bổ sung (`src/core/config/env.schema.ts`)

```ts
REDIS_PASSWORD: z.string().optional(),
REDIS_DB: z.coerce.number().int().min(0).default(0),
REDIS_KEY_PREFIX: z.string().default('app:'),
CACHE_DEFAULT_TTL: z.coerce.number().int().positive().default(60), // giây
```

- `REDIS_HOST` / `REDIS_PORT` giữ nguyên (đã có).
- **Log redaction**: `password`, `token`, `secret` đã nằm trong `log-redact.ts` → token lock & password không lọt log. Không cần thêm path mới.

## 7. Hạ tầng (`docker-compose.yml`) & bối cảnh Redis 8

- Hiện có service `redis: image: redis:8-alpine`, map `6380:6379`, **không password, không volume**.
- Spec **không bắt buộc** đổi compose, nhưng ghi nhận để prod:
  - Cân nhắc thêm volume cho persistence (AOF/RDB) nếu cache/lock cần bền.
  - Thêm `--requirepass` + `REDIS_PASSWORD` ở môi trường thật.
  - Local dev: Redis ở host port **6380**; `REDIS_PORT` env phải khớp khi chạy app ngoài Docker (mặc định schema là 6379 — chỉnh `.env` khi cần).

### Redis 8 — điểm liên quan thiết kế (nguồn: Redis docs qua Context7)

- **Không phụ thuộc tính năng chỉ-có-ở-8.4**: thiết kế dùng `SET NX PX`, sorted set, `EVAL/EVALSHA` (qua `defineCommand`) — chạy được trên Redis 6/7/8. Nhờ vậy tag floating `redis:8-alpine` (không rõ pin 8.0/8.2/8.4) **vẫn an toàn**. Chỉ khi nào quyết định dùng feature 8.4+ mới cần pin minor (vd `redis:8.4-alpine`).
- **`SET … IFEQ/IFNE/IFDEQ/IFDNE` và `DELEX … IFEQ`** (compare-and-set / compare-and-delete native, **từ 8.4**): có thể thay Lua release-lock. Đã cân nhắc và **giữ Lua** (xem mục Lock 5.2) — chủ động không khóa phiên bản.
- **Hash field TTL (`HEXPIRE`, từ Redis 8)**: một hướng rate-limit thay thế (token bucket theo field). Không dùng — sliding-window log bằng sorted set đã đủ và doc Redis vẫn khuyến nghị Lua cho atomic read-decide-update.
- **ioredis 5 ⇄ Redis 8**: tương thích. Pub/sub giữ **connection riêng** bất kể RESP2/RESP3 (an toàn, không phụ thuộc hành vi RESP3 cho phép lệnh thường trong subscriber mode). `defineCommand` vẫn dùng `EVALSHA` ngầm trên Redis 8.

## 8. Health check (`src/core/health/`)

- Bổ sung Redis vào health: `REDIS_CLIENT.ping()` có timeout ngắn, đưa `redis: 'up' | 'down'` vào `health-response.dto.ts`.
- Giữ pattern Swagger gom trong `health/decorators/` như hiện tại.

## 9. Test plan (`test/unit/core/redis/`)

Mirror cấu trúc `src/`, import qua alias `@core/redis/...`, mock **port** bằng `useValue`; với impl thì stub raw ioredis client (object có `set`/`get`/`eval`/`defineCommand`…). `jest.clearAllMocks()` trong `beforeEach`.

- **CacheService**: miss trả `null`; set rồi get trả đúng (qua stub); `getOrSet` gọi `factory` đúng 1 lần khi miss, không gọi khi hit; TTL mặc định áp khi không truyền.
- **LockService**: acquire trả `Lock` (kèm `fencingToken`) khi Lua `acquireLock` trả số; trả `null` khi trả `nil` (đã bị giữ); fencingToken tăng dần qua các lần acquire; `release` chỉ del khi token khớp (Lua trả 1), không del khi token lệch (trả 0); `withLock` ném `AppException` status `CONFLICT` khi không acquire được; `withLock` luôn `release` trong `finally` kể cả `fn` ném.
- **RateLimitService**: dưới ngưỡng → `allowed=true`, `remaining` giảm dần; chạm ngưỡng → `allowed=false`; sau cửa sổ → reset.
- **PubSubService**: `publish` gọi `client.publish` với JSON đúng; `subscribe` đăng ký channel và dispatch handler khi có message; parse JSON.

## 10. Thứ tự implement đề xuất (cho bước writing-plans sau)

1. **Thêm dependency `ioredis@^5`** (`pnpm add ioredis`) + env mới + `redis.constants.ts` + `redis.provider.ts` (gồm `buildRedisBaseOptions` dùng chung) + `redis.module.ts`. **Cập nhật `QueueModule`** spread `buildRedisBaseOptions` + `maxRetriesPerRequest: null` (password/db khớp BullMQ, KHÔNG áp keyPrefix). Tiêu chí: connection chạy, health ping xanh, BullMQ vẫn hoạt động.
2. CacheService (port + impl + test).
3. **Thêm i18n message** `redis.LOCK_ACQUISITION_FAILED` (`redis.messages.ts` + `src/i18n/{vi,en}/redis.json` + `pnpm i18n:gen`) → LockService + Lua `acquire-lock`/`release-lock` + fencing token (port + impl + test).
4. RateLimitService + Lua sliding-window (port + impl + test).
5. PubSubService (port + impl + test).
6. Health check Redis + cập nhật CLAUDE.md mục core/redis.

## Phụ lục — nguồn tham khảo cập nhật

- ioredis `defineCommand` (Lua, EVALSHA ngầm) & pub/sub cần connection riêng — docs ioredis qua Context7 (`/redis/ioredis`).
- Redlock 1-node `SET NX PX` + Lua compare-then-del + fencing token — [redis.io: Distributed Locks](https://redis.io/docs/latest/develop/clients/patterns/distributed-locks/).
- Redis 8.4 `SET … IFEQ` / `DELEX … IFEQ` (compare-and-set/delete native) & hash field TTL (`HEXPIRE`) & rate-limiter vẫn khuyến nghị Lua `EVAL` — Redis docs qua Context7 (`/redis/docs`: transactions, distributed-locks, use-cases/rate-limiter).
- Bối cảnh module NestJS Redis (cache/lock/rate-limit) — khảo sát web 2026 (nestjs-redlock-universal, @nestjs-redisx) — tham khảo, không dùng làm dependency.
