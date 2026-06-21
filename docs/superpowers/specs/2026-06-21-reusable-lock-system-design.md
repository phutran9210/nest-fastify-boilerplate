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
    waitMs: number;        // tổng thời gian chờ tối đa (deadline đơn điệu, xem §3)
    minDelayMs?: number;   // mặc định 50
    maxDelayMs?: number;   // mặc định 400 — backoff full-jitter
  };
  autoRenew?: boolean;            // bật watchdog (best-effort liveness), mặc định false — xem §4
  fencing?: boolean;              // MỚI — chỉ cấp fencingToken khi true (tránh leak key, xem §4.4); mặc định false
  onTimeout?: 'throw' | 'return'; // mặc định 'throw' (409) — chỉ áp dụng cho withLock
}

interface Lock {
  key: string;
  token: string;            // random, nhận diện chủ lock (dùng khi release/extend)
  fencingToken: number | null; // counter tăng dần khi opts.fencing=true; null nếu không yêu cầu fencing
  signal: AbortSignal;      // MỚI — abort khi watchdog phát hiện mất lock (xem §4.2); luôn có
  release(): Promise<boolean>;
  extend(ttlMs: number): Promise<boolean>; // MỚI — gia hạn thủ công, chỉ thành công khi token còn khớp
}

abstract class LockService {
  // Không retry → giữ y hệt hành vi cũ. Có opts.retry → vòng lặp tới deadline (§3).
  // Trả null nếu (sau retry) vẫn không lấy được — KHÔNG throw.
  abstract acquire(key: string, ttlMs: number, opts?: LockOptions): Promise<Lock | null>;

  // OVERLOADS — bảo toàn typing cho caller cũ:
  //   (1) không opts hoặc onTimeout!=='return' → Promise<T> (default 'throw' → 409)
  //   (2) onTimeout='return' → Promise<T | undefined> (skip fn khi không acquire được)
  abstract withLock<T>(key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>,
    opts?: Omit<LockOptions, 'onTimeout'> & { onTimeout?: 'throw' }): Promise<T>;
  abstract withLock<T>(key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>,
    opts: Omit<LockOptions, 'onTimeout'> & { onTimeout: 'return' }): Promise<T | undefined>;
}
```

**Hành vi mặc định (không truyền opts):**
- `acquire(key, ttl)` — non-blocking, giống hiện tại; `fencingToken=null` (KHÔNG tạo key fence).
- `withLock(key, ttl, fn)` — throw 409 khi không acquire được, trả `Promise<T>`, giống hiện tại.

**Validate input (mọi entry point):** `ttlMs > 0`; `retry.waitMs ≥ 0`, `minDelayMs > 0`, `maxDelayMs ≥ minDelayMs`. Giá trị không hợp lệ → throw lỗi lập trình (không phải 409). Khi `autoRenew=true` mà `ttlMs < 3000` → throw (TTL quá ngắn cho watchdog an toàn, xem §4.1).

---

## 3. Retry / wait

Khi có `opts.retry`:

- **Deadline đơn điệu:** `deadline = Date.now() + waitMs` tính một lần lúc vào. Dùng `Date.now()` so deadline (không cộng dồn sleep ước lượng).
- **Đảm bảo ≥1 lần thử:** luôn thử `acquire` non-blocking ít nhất một lần trước khi xét deadline (kể cả `waitMs=0`).
- Nếu null và `Date.now() < deadline`: sleep một khoảng **full-jitter** `random(0, min(maxDelayMs, base))` với `base` tăng dần (exponential) từ `minDelayMs`. **Cap mỗi sleep ≤ thời gian còn lại** (`deadline - Date.now()`) để không vượt `waitMs`, rồi thử lại.
- Dừng khi: acquire thành công (trả `Lock`), HOẶC `Date.now() ≥ deadline` (trả `null`).
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

Đăng ký qua `client.defineCommand('extendLock', extendLock)` trong `redis.provider.ts`, cạnh `acquireLock`/`releaseLock`. `acquireLock` cũng sửa để rẽ nhánh theo cờ fencing (xem §4.4): chỉ `INCR lock:fence:<key>` khi được yêu cầu, ngược lại trả `1` (placeholder) và caller bỏ qua.

### 4.2 Cơ chế watchdog (chỉ khi `opts.autoRenew === true`)

**Là best-effort liveness, KHÔNG phải safety.** Watchdog chỉ giúp lock không hết hạn sớm khi tác vụ chạy dài; nó KHÔNG đảm bảo tính loại trừ tuyệt đối (GC pause, network blip vẫn có thể khiến lock hết hạn và bị người khác chiếm). **Safety thực sự = fencing token kiểm tra ở điểm ghi** (xem §4.4). Tài liệu phải nói rõ điều này để caller không hiểu lầm.

- Yêu cầu `ttlMs ≥ 3000` (đã validate ở §2) → renew an toàn.
- **Self-scheduling single-flight timer** (KHÔNG `setInterval`): sau khi một lần extend hoàn tất, mới `setTimeout` lần kế tiếp ở `ttlMs / 3` ms (bỏ floor 1s). Tránh chồng lấn khi extend chậm.
- Mỗi lần gọi `extendLock(token, ttlMs)` được **bọc try/catch** — lỗi Redis (reject) KHÔNG trở thành unhandled rejection: log `warn`, lên lịch thử lại lần kế (cho tới khi mất lock hoặc release).
- Nếu extend trả `0` (đã mất lock) → **dừng watchdog, `abort()` `lock.signal`**, log `warn`. KHÔNG cố giành lại.
- `lock.signal` cho phép `fn` chủ động hủy công việc khi mất lock (`signal.aborted` / `signal.addEventListener('abort')`).
- `release()` và mọi đường thoát của `withLock` (kể cả throw): **hủy timer đang chờ + await lần extend in-flight** (nếu có) rồi mới thoát → không rò timer, không double-run.
- Timer dùng `.unref()` để không giữ process sống lúc shutdown.

### 4.3 `extend(ttlMs)` thủ công

Dùng cùng `extendLock`, dành cho caller dùng `acquire()` trực tiếp (không qua `withLock`) muốn tự kiểm soát gia hạn. Trả `true` nếu còn giữ lock, `false` nếu đã mất.

### 4.4 Fencing token — opt-in (chống leak key)

**Vấn đề ở thiết kế cũ:** `acquireLock` luôn `INCR lock:fence:<key>`, counter này KHÔNG bao giờ expire (không thể đặt TTL mà vẫn giữ tính đơn điệu). Key cardinality cao — đặc biệt lock per-`messageId` ở `src/core/messaging/consume.ts` — gây phình key vô hạn. Mà consumer đó **không hề dùng** `fencingToken`.

**Sửa:** fencing thành **opt-in** qua `opts.fencing`:
- `fencing` không bật (mặc định): `acquireLock` chỉ `SET NX PX`, **KHÔNG** chạm key fence → không tạo/không leak. `lock.fencingToken = null`.
- `fencing: true`: như cũ — `SET NX PX` + `INCR lock:fence:<key>`; `lock.fencingToken` là số. Dùng cho caller thực sự so token ở điểm ghi.
- Lua `acquireLock` nhận thêm cờ ARGV để rẽ nhánh có/không INCR (một script, hai nhánh).

**Migration:** lock messaging (`consume.ts`) giữ mặc định (không fencing) → ngừng tạo `lock:fence:messaging:lock:*`. Key fence cũ còn sót sẽ tự nằm im (không tăng thêm); có thể dọn thủ công một lần nếu muốn (ngoài scope, ghi chú ở plan).

---

## 5. Decorator `@WithLock`

Interceptor của Nest **không fire** khi gọi method service nội bộ, nên decorator phải tự lấy `LockService`. Dùng pattern "service holder" — đúng tinh thần `@Transactional`/ALS đã có trong repo.

### 5.1 Holder — `decorators/with-lock.decorator.ts`

```ts
let lockServiceRef: LockService | null = null;
export function setLockServiceRef(s: LockService) {
  if (lockServiceRef && lockServiceRef !== s) {
    // Multi-context (vd test tạo nhiều app) → cảnh báo ghi đè để không dùng nhầm service cũ.
    logger.warn('LockService ref bị ghi đè bởi context khác');
  }
  lockServiceRef = s;
}
export function clearLockServiceRef(s: LockService) {
  if (lockServiceRef === s) lockServiceRef = null; // chỉ chủ hiện tại được clear
}
export function getLockServiceRef(): LockService {
  if (!lockServiceRef) throw new Error('LockService chưa được bootstrap — RedisModule phải nạp trước.');
  return lockServiceRef;
}
```

**Vòng đời (định nghĩa rõ để an toàn multi-context/test):**
- `RedisModule implements OnModuleInit` → `setLockServiceRef(this.lockService)`.
- `RedisModule` (đã có `OnModuleDestroy` để quit Redis) → thêm `clearLockServiceRef(this.lockService)` **trước** khi quit client → tránh để lại ref trỏ service có Redis đã đóng.
- Ghi đè bởi context khác → `warn` (không silent). Test phải teardown app (`app.close()`) để chạy `OnModuleDestroy`.

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
//   const original = descriptor.value;
//   descriptor.value = function (...args: A) {
//     const key = meta.key(...args);
//     return getLockServiceRef().withLock(key, meta.ttlMs,
//       () => original.apply(this, args),
//       { retry: meta.retry, autoRenew: meta.autoRenew, onTimeout: meta.onTimeout });
//   };
//   // BẮT BUỘC: copy reflect-metadata từ original sang wrapper (xem dưới)
//   for (const k of Reflect.getMetadataKeys(original))
//     Reflect.defineMetadata(k, Reflect.getMetadata(k, original), descriptor.value);
```

**Bảo toàn metadata khi compose (vd `@Cron`, `@RabbitSubscribe`, `@Processor`):** vì `@WithLock` thay `descriptor.value`, mọi reflect-metadata Nest gắn lên hàm gốc phải được **copy sang wrapper**, nếu không decorator khác (tuỳ thứ tự áp dụng) sẽ mất metadata. Plan phải có test compose `@WithLock` với một message subscriber để khẳng định metadata còn nguyên.

Ví dụ dùng:

```ts
@WithLock({ key: (userId: string) => `user:${userId}:sync`, ttlMs: 30_000, retry: { waitMs: 5_000 } })
async syncUser(userId: string) { /* ... */ }
```

**Lưu ý typing & loss-awareness:**
- `@WithLock` **giấu `Lock`** → method không thấy `lock.signal`. Nếu critical section cần biết khi mất lock (long-running + safety), **dùng `withLock(...)` trực tiếp** và kiểm tra `lock.signal`/`lock.fencingToken`, KHÔNG dùng decorator.
- Khi `onTimeout:'return'`, method có thể trả `undefined` mà không chạy thân (giống job idempotent) — nhưng kiểu khai báo của method vẫn là kiểu gốc; caller phải tự ý thức khả năng `undefined`. Mặc định `'throw'` → 409, không có rủi ro này.

---

## 6. Quy ước key & observability

### 6.1 Naming key dùng chung

Format: `<domain>:<id>[:<action>]` — ví dụ `user:42:sync`, `outbox:relay`, `invoice:1001`.

- `LockService` tự prepend `lock:` (key Redis); chỉ tạo `lock:fence:<key>` khi `opts.fencing=true` (§4.4). **Caller chỉ truyền phần nghiệp vụ**, KHÔNG tự thêm `lock:`.
- Lock cross-service phải đặt tên ổn định, KHÔNG nhúng giá trị thay đổi (timestamp…).
- **Chỉ bật `fencing` khi thực sự so token ở điểm ghi.** Với key cardinality cao (per-id ngắn hạn) để mặc định off, tránh phình key.

### 6.2 Observability

- Dùng `Logger`/`PinoLogger` (KHÔNG `console`).
- `debug` cho acquire/release; `warn` khi watchdog mất lock hoặc retry timeout.
- Log kèm `{ key, fencingToken }` (fencingToken có thể null). KHÔNG log `token`.

### 6.3 Messages

`onTimeout:'throw'` tái dùng `RedisMessage.LOCK_ACQUISITION_FAILED` (đã có). Không cần message mới.

---

## 7. Cấu trúc file

```
src/core/redis/
├── ports/lock.service.port.ts        # + LockOptions, Lock.extend()/signal/fencingToken|null
├── services/lock.service.ts          # + retry loop, self-scheduling watchdog, extend, fencing opt-in
├── scripts/extend-lock.lua.ts        # MỚI
├── scripts/acquire-lock.lua.ts       # SỬA: rẽ nhánh fencing (INCR có điều kiện)
├── decorators/with-lock.decorator.ts # MỚI: @WithLock + holder (set/clear/get) + copy metadata
├── redis.provider.ts                 # + defineCommand('extendLock')
└── redis.module.ts                   # + OnModuleInit set / OnModuleDestroy clear lockServiceRef
```

CLAUDE.md (mục Redis): bổ sung 1 dòng về convention lock key, fencing opt-in, `@WithLock`.

---

## 8. Testing (`test/unit/core/redis/`)

- `lock.service.spec.ts`: mock `REDIS_CLIENT` (object có `acquireLock`/`releaseLock`/`extendLock`). Test:
  - retry: acquire fail→success trước deadline; timeout→null / throw 409 / return undefined theo `onTimeout`; **sleep cuối không vượt `waitMs`** (cap remaining); `waitMs=0` vẫn thử 1 lần.
  - validate input: ttl≤0, retry value âm, maxDelay<minDelay → throw; `autoRenew` với ttl<3000 → throw.
  - fencing: mặc định KHÔNG gọi INCR/không tạo key fence, `fencingToken=null`; `fencing:true` → có `INCR`, token là số.
  - watchdog (fake timers): self-scheduling extend đúng nhịp `ttl/3` không floor; lần extend chậm KHÔNG chồng lấn; extend reject → log warn + lên lịch tiếp (không crash); mất lock (extend→0)→dừng + `lock.signal` aborted; release/throw → hủy timer + await in-flight.
  - `extend()` thủ công: true khi còn token, false khi mất.
- `with-lock.decorator.spec.ts`: holder chưa set→throw; ghi đè ref→warn; key factory dựng đúng key; opts truyền xuống `withLock`; `onTimeout:'return'`→thân method không chạy; **reflect-metadata được copy** (compose với một decorator gắn metadata).
- `jest.useFakeTimers()` cho watchdog/backoff; `jest.clearAllMocks()` trong `beforeEach`.

---

## 9. Tương thích ngược

- Mọi `acquire(key, ttl)` / `withLock(key, ttl, fn)` hiện hữu chạy không đổi (opts optional, mặc định = hành vi cũ).
- `Lock` thêm `extend()` + `signal` — chỉ bổ sung, không phá vỡ consumer hiện tại.
- **`withLock` dùng overloads** (§2): nhánh mặc định/`'throw'` giữ nguyên `Promise<T>` → caller cũ KHÔNG đổi typing; chỉ nhánh `{ onTimeout: 'return' }` trả `Promise<T | undefined>`.
- **Thay đổi hành vi runtime có chủ đích:** `fencingToken` từ luôn-là-số → `null` khi không bật `fencing`. Caller hiện tại của `LockService` (`consume.ts`) KHÔNG đọc `fencingToken` (đã kiểm chứng) → an toàn. Bất kỳ caller mới cần token phải bật `fencing:true`.

---

## 10. Out of scope (YAGNI)

- Multi-node Redlock (chỉ 1 Redis).
- Reentrant lock / lock theo thread-local.
- Fair queue (FIFO) cho waiter — retry + jitter là đủ.
