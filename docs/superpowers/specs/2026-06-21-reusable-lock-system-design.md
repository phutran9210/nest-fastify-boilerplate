# Reusable Shared Lock System — Design

**Date:** 2026-06-21
**Status:** Approved (pending spec review)
**Scope:** Nâng cấp `LockService` (`src/core/redis/`) thành hệ thống lock dùng chung tái sử dụng cho toàn hệ thống.

---

## 1. Bối cảnh & mục tiêu

Hệ thống đã có `LockService` (port + Redis impl) với: `acquire`/`withLock`, fencing token, compare-then-del release qua Lua. Hạn chế hiện tại:

- `acquire` non-blocking — thất bại là throw 409 ngay, không retry/chờ.
- Không có auto-renew → tác vụ dài hơn TTL bị mất lock giữa chừng.
- Không có cách dùng tiện kiểu decorator → mỗi nơi tự viết `withLock` boilerplate.
- Chưa có convention key/observability dùng chung.

**Mục tiêu:** thêm retry/wait, watchdog auto-renew (opt-in), decorator `@WithLock`, và chuẩn hoá pattern — **không phá vỡ caller hiện tại** (options đều optional, mặc định giữ hành vi cũ).

**Chọn hướng A:** mở rộng `LockService` sẵn có (một port duy nhất) thay vì tạo lớp `LockManager` riêng hoặc dùng `node-redlock`. Giữ fencing token + Lua tự xây.

---

## 2. API surface — port `LockService`

Mở rộng port hiện tại, giữ chữ ký cũ tương thích ngược (options optional).

```ts
interface LockOptions {
  retry?: {
    waitMs: number;        // tổng thời gian chờ tối đa
    minDelayMs?: number;   // mặc định 50
    maxDelayMs?: number;   // mặc định 400 — backoff full-jitter
  };
  autoRenew?: boolean;            // bật watchdog, mặc định false
  onTimeout?: 'throw' | 'return'; // mặc định 'throw' (409) — chỉ áp dụng cho withLock
}

interface Lock {
  key: string;
  token: string;            // random, nhận diện chủ lock (dùng khi release/extend)
  fencingToken: number;     // counter tăng dần — consumer so cũ/mới để chặn ghi đè
  release(): Promise<boolean>;
  extend(ttlMs: number): Promise<boolean>; // MỚI — gia hạn thủ công, chỉ thành công khi token còn khớp
}

abstract class LockService {
  // Không retry → giữ y hệt hành vi cũ. Có opts.retry → vòng lặp tới waitMs.
  // Trả null nếu (sau retry) vẫn không lấy được — KHÔNG throw.
  abstract acquire(key: string, ttlMs: number, opts?: LockOptions): Promise<Lock | null>;

  // onTimeout='throw' (mặc định) → AppException 409 LOCK_ACQUISITION_FAILED.
  // onTimeout='return' → trả undefined, KHÔNG chạy fn.
  abstract withLock<T>(
    key: string,
    ttlMs: number,
    fn: (lock: Lock) => Promise<T>,
    opts?: LockOptions,
  ): Promise<T | undefined>;
}
```

**Hành vi mặc định (không truyền opts):**
- `acquire(key, ttl)` — non-blocking, giống hiện tại.
- `withLock(key, ttl, fn)` — throw 409 khi không acquire được, giống hiện tại.

---

## 3. Retry / wait

Khi có `opts.retry`:

- Vòng lặp: thử `acquire` non-blocking; nếu null, sleep một khoảng **full-jitter** `random(0, min(maxDelayMs, base))` với `base` tăng dần (exponential) từ `minDelayMs`, rồi thử lại.
- Dừng khi: acquire thành công (trả `Lock`), HOẶC tổng thời gian đã chờ ≥ `waitMs` (trả `null`).
- `withLock` áp `onTimeout` lên kết quả null sau retry: `'throw'` → 409; `'return'` → trả `undefined`, không chạy `fn`.

Mặc định: `minDelayMs=50`, `maxDelayMs=400`.

---

## 4. Watchdog (auto-renew) & gia hạn an toàn

### 4.1 Lua script mới — `scripts/extend-lock.lua.ts`

Chỉ `PEXPIRE` khi token khớp (tránh gia hạn nhầm lock người khác đã chiếm sau khi mình mất nó):

```lua
-- KEYS[1]=lock:<key>; ARGV[1]=token, ARGV[2]=ttlMs
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
else
  return 0
end
```

Đăng ký qua `client.defineCommand('extendLock', extendLock)` trong `redis.provider.ts`, cạnh `acquireLock`/`releaseLock`.

### 4.2 Cơ chế watchdog (chỉ khi `opts.autoRenew === true`)

- Sau khi acquire thành công, đặt `setInterval` chu kỳ `Math.max(ttlMs / 3, 1000)` ms, mỗi lần gọi `extendLock(token, ttlMs)`.
- Nếu một lần extend trả `0` (đã mất lock) → **clear interval, dừng tự gia hạn** (KHÔNG cố giành lại; fencing token để consumer phát hiện ghi đè). Log `warn`.
- `release()` và mọi đường thoát của `withLock` (kể cả throw) **luôn clear interval** trong `finally` → không rò timer.
- `interval.unref()` để watchdog không giữ process sống khi shutdown.

### 4.3 `extend(ttlMs)` thủ công

Dùng cùng `extendLock`, dành cho caller dùng `acquire()` trực tiếp (không qua `withLock`) muốn tự kiểm soát gia hạn.

---

## 5. Decorator `@WithLock`

Interceptor của Nest **không fire** khi gọi method service nội bộ, nên decorator phải tự lấy `LockService`. Dùng pattern "service holder" — đúng tinh thần `@Transactional`/ALS đã có trong repo.

### 5.1 Holder — `decorators/with-lock.decorator.ts`

```ts
let lockServiceRef: LockService | null = null;
export function setLockServiceRef(s: LockService) { lockServiceRef = s; }
export function getLockServiceRef(): LockService {
  if (!lockServiceRef) throw new Error('LockService chưa được bootstrap — RedisModule phải nạp trước.');
  return lockServiceRef;
}
```

`RedisModule implements OnModuleInit` → gọi `setLockServiceRef(this.lockService)` (inject `LockService` vào module).

### 5.2 Decorator

```ts
interface WithLockMetadata<A extends any[]> {
  key: (...args: A) => string;
  ttlMs: number;
  retry?: LockOptions['retry'];
  autoRenew?: boolean;
  onTimeout?: 'throw' | 'return';
}

function WithLock<A extends any[]>(meta: WithLockMetadata<A>): MethodDecorator;
// wrap descriptor.value:
//   const key = meta.key(...args);
//   return getLockServiceRef().withLock(key, meta.ttlMs,
//     () => original.apply(this, args),
//     { retry: meta.retry, autoRenew: meta.autoRenew, onTimeout: meta.onTimeout });
```

Ví dụ dùng:

```ts
@WithLock({ key: (userId: string) => `user:${userId}:sync`, ttlMs: 30_000, retry: { waitMs: 5_000 } })
async syncUser(userId: string) { /* ... */ }
```

**Lưu ý:** khi `onTimeout:'return'`, method trả `undefined` mà không chạy thân — caller phải chịu được điều đó (giống job idempotent). Mặc định `'throw'` → 409.

---

## 6. Quy ước key & observability

### 6.1 Naming key dùng chung

Format: `<domain>:<id>[:<action>]` — ví dụ `user:42:sync`, `outbox:relay`, `invoice:1001`.

- `LockService` tự prepend `lock:` (key Redis) + `lock:fence:` (fencing) như hiện tại. **Caller chỉ truyền phần nghiệp vụ**, KHÔNG tự thêm `lock:`.
- Lock cross-service phải đặt tên ổn định, KHÔNG nhúng giá trị thay đổi (timestamp…).

### 6.2 Observability

- Dùng `Logger`/`PinoLogger` (KHÔNG `console`).
- `debug` cho acquire/release; `warn` khi watchdog mất lock hoặc retry timeout.
- Log kèm `{ key, fencingToken }`. KHÔNG log `token`.

### 6.3 Messages

`onTimeout:'throw'` tái dùng `RedisMessage.LOCK_ACQUISITION_FAILED` (đã có). Không cần message mới.

---

## 7. Cấu trúc file

```
src/core/redis/
├── ports/lock.service.port.ts        # + LockOptions, Lock.extend()
├── services/lock.service.ts          # + retry loop, watchdog, extend
├── scripts/extend-lock.lua.ts        # MỚI
├── decorators/with-lock.decorator.ts # MỚI: @WithLock + holder
├── redis.provider.ts                 # + defineCommand('extendLock')
└── redis.module.ts                   # + OnModuleInit setLockServiceRef
```

CLAUDE.md (mục Redis): bổ sung 1 dòng về convention lock key + nhắc `@WithLock`.

---

## 8. Testing (`test/unit/core/redis/`)

- `lock.service.spec.ts`: mock `REDIS_CLIENT` (object có `acquireLock`/`releaseLock`/`extendLock`). Test:
  - retry: acquire fail→success trong `waitMs`; timeout→null / throw 409 / return undefined theo `onTimeout`.
  - watchdog (fake timers): extend gọi đúng nhịp `ttl/3`; mất lock (extend→0)→dừng; `finally` clear interval kể cả khi `fn` throw.
  - `extend()` thủ công.
- `with-lock.decorator.spec.ts`: holder chưa set→throw; key factory dựng đúng key; opts truyền xuống `withLock`; `onTimeout:'return'`→thân method không chạy.
- `jest.useFakeTimers()` cho watchdog/backoff; `jest.clearAllMocks()` trong `beforeEach`.

---

## 9. Tương thích ngược

- Mọi `acquire(key, ttl)` / `withLock(key, ttl, fn)` hiện hữu chạy không đổi (opts optional, mặc định = hành vi cũ).
- `Lock` thêm `extend()` — chỉ bổ sung, không phá vỡ consumer hiện tại.
- `withLock` đổi kiểu trả về `Promise<T>` → `Promise<T | undefined>`: caller cũ (mặc định `'throw'`) thực tế luôn nhận `T`; chỉ ảnh hưởng typing khi dùng `onTimeout:'return'`.

---

## 10. Out of scope (YAGNI)

- Multi-node Redlock (chỉ 1 Redis).
- Reentrant lock / lock theo thread-local.
- Fair queue (FIFO) cho waiter — retry + jitter là đủ.
