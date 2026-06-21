# Reusable Shared Lock System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nâng cấp `LockService` (`src/core/redis/`) thành hệ thống lock dùng chung: retry/wait, watchdog auto-renew opt-in, fencing token opt-in, và decorator `@WithLock`.

**Architecture:** Mở rộng `LockService` sẵn có (một port duy nhất) — không tạo lớp mới, không thêm dependency. Lua scripts atomic cho acquire/release/extend. Decorator dùng "service holder" set ở vòng đời `RedisModule` (giống precedent `@Transactional`/ALS trong repo). Tất cả options optional → tương thích ngược, trừ contract fencing đổi (mặc định off).

**Tech Stack:** NestJS 11, ioredis (custom Lua qua `defineCommand`), Jest (fake timers), `AbortController`/`AbortSignal` (Node built-in), `reflect-metadata`.

## Global Constraints

- Package manager: **pnpm** (KHÔNG npm/yarn). Test: `pnpm test`, typecheck: `pnpm typecheck`, lint+format: `pnpm check`.
- `any` được phép (Biome `noExplicitAny` off). Custom command gọi qua `(client as any).<cmd>` như code hiện tại.
- Import vượt module/layer dùng path alias `@core/*`, `@common/*`, `@generated/*`. Trong cùng module (`src/core/redis/`) dùng relative.
- Test ở `test/unit/<mirror-src>/`, import source qua alias, mock **không** dùng `PrismaService`; ở đây mock `REDIS_CLIENT` bằng plain object.
- `jest.clearAllMocks()` trong `beforeEach`. Watchdog/backoff test dùng `jest.useFakeTimers()`.
- KHÔNG `console.*` — dùng `Logger`/`PinoLogger` từ `@nestjs/common`/`nestjs-pino`.
- Lock key business format `<domain>:<id>[:<action>]`; `LockService` tự prepend `lock:`/`lock:fence:`. Caller không tự thêm `lock:`.
- Spec nguồn: `docs/superpowers/specs/2026-06-21-reusable-lock-system-design.md`.

---

## File Structure

```
src/core/redis/
├── scripts/extend-lock.lua.ts          # CREATE — PEXPIRE-if-token-match
├── scripts/acquire-lock.lua.ts         # MODIFY — nhánh fencing (INCR có điều kiện)
├── redis.provider.ts                   # MODIFY — defineCommand('extendLock')
├── ports/lock.service.port.ts          # MODIFY — LockOptions, Lock.signal/extend/fencingToken|null, overloads
├── services/lock.service.ts            # MODIFY — validate, fencing opt-in, retry, watchdog, extend
├── decorators/with-lock.decorator.ts   # CREATE — holder + @WithLock + copy metadata
└── redis.module.ts                     # MODIFY — set/clear holder ở OnModuleInit/OnModuleDestroy

test/unit/core/redis/
├── scripts/lock-scripts.spec.ts        # CREATE
├── services/lock.service.spec.ts       # MODIFY (cập nhật contract) + thêm case mới
└── decorators/with-lock.decorator.spec.ts  # CREATE
```

---

### Task 1: Lua scripts (extend-lock + fencing branch) & provider wiring

**Files:**
- Create: `src/core/redis/scripts/extend-lock.lua.ts`
- Modify: `src/core/redis/scripts/acquire-lock.lua.ts`
- Modify: `src/core/redis/redis.provider.ts`
- Test: `test/unit/core/redis/scripts/lock-scripts.spec.ts`

**Interfaces:**
- Produces: `extendLock` script object `{ numberOfKeys: 1, lua: string }`; `acquireLock` Lua nhận ARGV[3] = fencing flag (`'1'`/`'0'`), trả `incr` (số) khi fencing, `1` khi không, `false` khi đã bị giữ. Provider đăng ký command `extendLock`.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/core/redis/scripts/lock-scripts.spec.ts
import { acquireLock } from '@core/redis/scripts/acquire-lock.lua';
import { extendLock } from '@core/redis/scripts/extend-lock.lua';
import { releaseLock } from '@core/redis/scripts/release-lock.lua';

describe('lock Lua scripts', () => {
  it('extendLock: 1 key, PEXPIRE chỉ khi token khớp', () => {
    expect(extendLock.numberOfKeys).toBe(1);
    expect(extendLock.lua).toContain('pexpire');
    expect(extendLock.lua).toContain('ARGV[1]'); // token compare
  });

  it('acquireLock: 2 keys, INCR có điều kiện theo ARGV[3]', () => {
    expect(acquireLock.numberOfKeys).toBe(2);
    expect(acquireLock.lua).toContain('ARGV[3]'); // fencing flag
    expect(acquireLock.lua).toContain('incr');
    expect(acquireLock.lua).toContain('set'); // SET NX PX vẫn còn
  });

  it('releaseLock không đổi: 1 key, compare-then-del', () => {
    expect(releaseLock.numberOfKeys).toBe(1);
    expect(releaseLock.lua).toContain('del');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lock-scripts`
Expected: FAIL — `Cannot find module '@core/redis/scripts/extend-lock.lua'` và `acquireLock.lua` chưa có `ARGV[3]`.

- [ ] **Step 3: Create extend-lock script**

```ts
// src/core/redis/scripts/extend-lock.lua.ts
// KEYS[1]=lock:<key>; ARGV[1]=token, ARGV[2]=ttlMs. Chỉ PEXPIRE khi token khớp (tránh
// gia hạn nhầm lock người khác đã chiếm). Trả 1 (gia hạn được) hoặc 0 (đã mất lock).
export const extendLock = {
  numberOfKeys: 1,
  lua: `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("pexpire", KEYS[1], tonumber(ARGV[2]))
else
  return 0
end`,
};
```

- [ ] **Step 4: Modify acquire-lock script (fencing branch)**

```ts
// src/core/redis/scripts/acquire-lock.lua.ts
// KEYS[1]=lock:<key>, KEYS[2]=lock:fence:<key>; ARGV[1]=token, ARGV[2]=ttlMs, ARGV[3]=fencing('1'|'0').
// Atomic SET NX PX. Nếu fencing='1' → INCR fencing và trả fencingToken; nếu '0' → KHÔNG chạm
// KEYS[2] (tránh leak key) và trả 1 (placeholder). Đã bị giữ → false (→ null).
export const acquireLock = {
  numberOfKeys: 2,
  lua: `
if redis.call("set", KEYS[1], ARGV[1], "NX", "PX", tonumber(ARGV[2])) then
  if ARGV[3] == "1" then
    return redis.call("incr", KEYS[2])
  else
    return 1
  end
else
  return false
end`,
};
```

- [ ] **Step 5: Register extendLock in provider**

Trong `src/core/redis/redis.provider.ts`, thêm import và `defineCommand` trong `createRedisClient`:

```ts
import { extendLock } from './scripts/extend-lock.lua';
// ...
export function createRedisClient(config: ConfigService): Redis {
  const client = new Redis(appOptions(config));
  client.defineCommand('acquireLock', acquireLock);
  client.defineCommand('releaseLock', releaseLock);
  client.defineCommand('extendLock', extendLock);
  client.defineCommand('rateLimit', rateLimit);
  return client;
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `pnpm test -- lock-scripts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add src/core/redis/scripts/extend-lock.lua.ts src/core/redis/scripts/acquire-lock.lua.ts src/core/redis/redis.provider.ts test/unit/core/redis/scripts/lock-scripts.spec.ts
git commit -m "feat(redis): add extend-lock script + fencing-aware acquire-lock"
```

---

### Task 2: Port interface + service core (validate, fencing opt-in, extend, signal)

Cập nhật port và viết lại `acquire`/`withLock` ở mức cơ bản (chưa retry/watchdog) — giữ repo compile và cập nhật test cũ sang contract mới.

**Files:**
- Modify: `src/core/redis/ports/lock.service.port.ts`
- Modify: `src/core/redis/services/lock.service.ts`
- Test: `test/unit/core/redis/services/lock.service.spec.ts`

**Interfaces:**
- Produces:
  - `interface LockOptions { retry?: { waitMs: number; minDelayMs?: number; maxDelayMs?: number }; autoRenew?: boolean; fencing?: boolean; onTimeout?: 'throw' | 'return' }`
  - `interface Lock { key: string; token: string; fencingToken: number | null; signal: AbortSignal; release(): Promise<boolean>; extend(ttlMs: number): Promise<boolean> }`
  - `LockService.acquire(key, ttlMs, opts?): Promise<Lock | null>`
  - `LockService.withLock` overloads (default/`throw` → `Promise<T>`; `{onTimeout:'return'}` → `Promise<T | undefined>`)
- Consumes: scripts/provider command `extendLock` từ Task 1.

- [ ] **Step 1: Update the test to the new contract + add validation/fencing/extend cases**

Thay nội dung `test/unit/core/redis/services/lock.service.spec.ts`. Mock client thêm `extendLock`. Sửa case fencing mặc định và 5-arg call:

```ts
import { AppException } from '@common/exceptions/app.exception';
import { LockService } from '@core/redis/ports/lock.service.port';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { RedisLockService } from '@core/redis/services/lock.service';
import { Test } from '@nestjs/testing';

describe('RedisLockService', () => {
  const client = { acquireLock: jest.fn(), releaseLock: jest.fn(), extendLock: jest.fn() };
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

  it('acquire mặc định KHÔNG fencing: fencingToken=null, gọi 5 arg cờ "0"', async () => {
    client.acquireLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(lock).toMatchObject({ key: 'job', fencingToken: null });
    expect(typeof lock?.token).toBe('string');
    expect(client.acquireLock).toHaveBeenCalledWith(
      'lock:job', 'lock:fence:job', expect.any(String), 5000, '0',
    );
  });

  it('acquire fencing:true: fencingToken là số, cờ "1"', async () => {
    client.acquireLock.mockResolvedValue(7);
    const lock = await service.acquire('job', 5000, { fencing: true });
    expect(lock).toMatchObject({ fencingToken: 7 });
    expect(client.acquireLock).toHaveBeenCalledWith(
      'lock:job', 'lock:fence:job', expect.any(String), 5000, '1',
    );
  });

  it('acquire trả null khi script trả false (đã bị giữ)', async () => {
    client.acquireLock.mockResolvedValue(false);
    expect(await service.acquire('job', 5000)).toBeNull();
  });

  it('lock.signal có sẵn và chưa abort khi mới acquire', async () => {
    client.acquireLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(lock?.signal.aborted).toBe(false);
  });

  it('extend gọi extendLock đúng token, true khi trả 1', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.extendLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.extend(5000)).toBe(true);
    expect(client.extendLock).toHaveBeenCalledWith('lock:job', lock?.token, 5000);
  });

  it('release del đúng token, true khi trả 1', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.release()).toBe(true);
    expect(client.releaseLock).toHaveBeenCalledWith('lock:job', lock?.token);
  });

  it('validate: ttl<=0 ném lỗi lập trình', async () => {
    await expect(service.acquire('job', 0)).rejects.toThrow();
  });

  it('validate: autoRenew với ttl<3000 ném lỗi', async () => {
    await expect(service.acquire('job', 2000, { autoRenew: true })).rejects.toThrow();
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
      service.withLock('job', 5000, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(client.releaseLock).toHaveBeenCalled();
  });

  it('withLock ném AppException(409) khi không acquire (default throw)', async () => {
    client.acquireLock.mockResolvedValue(false);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toBeInstanceOf(AppException);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toMatchObject({ status: 409 });
  });

  it('withLock onTimeout:return trả undefined, KHÔNG chạy fn', async () => {
    client.acquireLock.mockResolvedValue(false);
    const fn = jest.fn();
    const out = await service.withLock('job', 5000, fn, { onTimeout: 'return' });
    expect(out).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lock.service`
Expected: FAIL — `extendLock`/`signal`/`fencing` chưa tồn tại; default fencingToken vẫn là số cũ.

- [ ] **Step 3: Update the port**

```ts
// src/core/redis/ports/lock.service.port.ts
export interface LockOptions {
  retry?: { waitMs: number; minDelayMs?: number; maxDelayMs?: number };
  autoRenew?: boolean;
  fencing?: boolean;
  onTimeout?: 'throw' | 'return';
}

export interface Lock {
  key: string;
  token: string;
  fencingToken: number | null; // số khi opts.fencing=true; null nếu không yêu cầu fencing
  signal: AbortSignal;         // abort khi watchdog phát hiện mất lock (autoRenew)
  release(): Promise<boolean>;
  extend(ttlMs: number): Promise<boolean>;
}

export abstract class LockService {
  abstract acquire(key: string, ttlMs: number, opts?: LockOptions): Promise<Lock | null>;

  abstract withLock<T>(
    key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>,
    opts?: Omit<LockOptions, 'onTimeout'> & { onTimeout?: 'throw' },
  ): Promise<T>;
  abstract withLock<T>(
    key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>,
    opts: Omit<LockOptions, 'onTimeout'> & { onTimeout: 'return' },
  ): Promise<T | undefined>;
}
```

- [ ] **Step 4: Rewrite the service (core: validate + acquire + extend + withLock)**

```ts
// src/core/redis/services/lock.service.ts
import { randomBytes } from 'node:crypto';
import { AppException } from '@common/exceptions/app.exception';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type Lock, type LockOptions, LockService } from '../ports/lock.service.port';
import { REDIS_CLIENT } from '../redis.constants';
import { RedisMessage } from '../redis.messages';

function validateLockArgs(ttlMs: number, opts?: LockOptions): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`LockService: ttlMs phải > 0 (nhận ${ttlMs})`);
  }
  if (opts?.retry) {
    const { waitMs, minDelayMs = 50, maxDelayMs = 400 } = opts.retry;
    if (!Number.isFinite(waitMs) || waitMs < 0) throw new Error('LockService: retry.waitMs phải >= 0');
    if (minDelayMs <= 0) throw new Error('LockService: retry.minDelayMs phải > 0');
    if (maxDelayMs < minDelayMs) throw new Error('LockService: retry.maxDelayMs phải >= minDelayMs');
  }
  if (opts?.autoRenew && ttlMs < 3000) {
    throw new Error('LockService: autoRenew yêu cầu ttlMs >= 3000ms để watchdog an toàn');
  }
}

@Injectable()
export class RedisLockService extends LockService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: Redis) {
    super();
  }

  async acquire(key: string, ttlMs: number, opts?: LockOptions): Promise<Lock | null> {
    validateLockArgs(ttlMs, opts);
    const fencing = opts?.fencing ?? false;
    const lockKey = `lock:${key}`;
    const fenceKey = `lock:fence:${key}`;

    const tryOnce = async (): Promise<{ token: string; fencingToken: number | null } | null> => {
      const token = randomBytes(20).toString('hex');
      const res = await (this.client as any).acquireLock(
        lockKey, fenceKey, token, ttlMs, fencing ? '1' : '0',
      );
      if (res === false || res === null) return null;
      return { token, fencingToken: fencing ? Number(res) : null };
    };

    const got = await tryOnce();
    if (!got) return null;
    return this.buildLock(key, lockKey, got.token, got.fencingToken, ttlMs, opts);
  }

  // overloads khai báo ở port; impl dùng signature rộng.
  async withLock<T>(
    key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>, opts?: LockOptions,
  ): Promise<T | undefined> {
    const lock = await this.acquire(key, ttlMs, opts);
    if (!lock) {
      if (opts?.onTimeout === 'return') return undefined;
      throw new AppException(RedisMessage.LOCK_ACQUISITION_FAILED, HttpStatus.CONFLICT);
    }
    try {
      return await fn(lock);
    } finally {
      await lock.release();
    }
  }

  private buildLock(
    key: string, lockKey: string, token: string, fencingToken: number | null,
    ttlMs: number, _opts?: LockOptions,
  ): Lock {
    const controller = new AbortController();
    const extend = async (ms: number): Promise<boolean> =>
      (await (this.client as any).extendLock(lockKey, token, ms)) === 1;
    const release = async (): Promise<boolean> =>
      (await (this.client as any).releaseLock(lockKey, token)) === 1;
    return { key, token, fencingToken, signal: controller.signal, release, extend };
  }
}
```

> Lưu ý: `_opts`/`controller` sẽ được dùng đầy đủ ở Task 4 (watchdog). Hiện `withLock` impl trả `Promise<T | undefined>` nhưng port overloads vẫn cho caller default nhận `Promise<T>`.

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test -- lock.service`
Expected: PASS. Sau đó `pnpm typecheck` để chắc overloads + caller cũ (`consume.ts`) compile.

Run: `pnpm typecheck`
Expected: PASS (không lỗi type ở `consume.ts`).

- [ ] **Step 6: Commit**

```bash
git add src/core/redis/ports/lock.service.port.ts src/core/redis/services/lock.service.ts test/unit/core/redis/services/lock.service.spec.ts
git commit -m "feat(redis): fencing opt-in, lock.signal/extend, withLock overloads + validation"
```

---

### Task 3: Retry / wait (monotonic deadline, capped jitter)

**Files:**
- Modify: `src/core/redis/services/lock.service.ts`
- Test: `test/unit/core/redis/services/lock.service.spec.ts`

**Interfaces:**
- Consumes: `tryOnce` closure trong `acquire`, `LockOptions.retry`.
- Produces: `acquire` retry tới deadline; `withLock` áp `onTimeout` lên null sau retry.

- [ ] **Step 1: Write the failing test (append vào describe)**

```ts
it('acquire retry: fail lần đầu, success trong waitMs', async () => {
  client.acquireLock.mockResolvedValueOnce(false).mockResolvedValueOnce(1);
  const lock = await service.acquire('job', 5000, { retry: { waitMs: 1000, minDelayMs: 1, maxDelayMs: 2 } });
  expect(lock).not.toBeNull();
  expect(client.acquireLock).toHaveBeenCalledTimes(2);
});

it('acquire retry: hết deadline vẫn fail → null', async () => {
  client.acquireLock.mockResolvedValue(false);
  const lock = await service.acquire('job', 5000, { retry: { waitMs: 30, minDelayMs: 1, maxDelayMs: 2 } });
  expect(lock).toBeNull();
  expect(client.acquireLock.mock.calls.length).toBeGreaterThanOrEqual(1);
});

it('acquire retry waitMs=0: vẫn thử đúng 1 lần', async () => {
  client.acquireLock.mockResolvedValue(false);
  const lock = await service.acquire('job', 5000, { retry: { waitMs: 0 } });
  expect(lock).toBeNull();
  expect(client.acquireLock).toHaveBeenCalledTimes(1);
});

it('withLock retry hết hạn + onTimeout:return → undefined', async () => {
  client.acquireLock.mockResolvedValue(false);
  const fn = jest.fn();
  const out = await service.withLock('job', 5000, fn, { retry: { waitMs: 20, minDelayMs: 1, maxDelayMs: 2 }, onTimeout: 'return' });
  expect(out).toBeUndefined();
  expect(fn).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lock.service`
Expected: FAIL — retry chưa được implement (acquire chỉ thử 1 lần → test "success trong waitMs" expect 2 calls fail).

- [ ] **Step 3: Add retry to acquire**

Trong `acquire`, thay đoạn `const got = await tryOnce(); if (!got) return null;`:

```ts
    let got = await tryOnce();
    if (!got && opts?.retry) got = await this.retryAcquire(tryOnce, opts.retry);
    if (!got) return null;
```

Thêm helper + `sleep` trong class:

```ts
  private async retryAcquire(
    tryOnce: () => Promise<{ token: string; fencingToken: number | null } | null>,
    retry: NonNullable<LockOptions['retry']>,
  ): Promise<{ token: string; fencingToken: number | null } | null> {
    const { waitMs, minDelayMs = 50, maxDelayMs = 400 } = retry;
    const deadline = Date.now() + waitMs; // deadline đơn điệu
    let base = minDelayMs;
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now();
      const cap = Math.min(maxDelayMs, base);
      const delay = Math.min(Math.floor(Math.random() * cap), remaining); // cap ≤ remaining
      await this.sleep(delay);
      const got = await tryOnce();
      if (got) return got;
      base = Math.min(base * 2, maxDelayMs);
    }
    return null;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lock.service`
Expected: PASS (gồm cả case mới).

- [ ] **Step 5: Commit**

```bash
git add src/core/redis/services/lock.service.ts test/unit/core/redis/services/lock.service.spec.ts
git commit -m "feat(redis): lock acquire retry with monotonic deadline + capped jitter"
```

---

### Task 4: Watchdog auto-renew (self-scheduling, single-flight, signal abort)

**Files:**
- Modify: `src/core/redis/services/lock.service.ts`
- Test: `test/unit/core/redis/services/lock.service.spec.ts`

**Interfaces:**
- Consumes: `buildLock`, `extendLock` command, `AbortController`.
- Produces: khi `opts.autoRenew`, watchdog tự gia hạn ở `ttlMs/3`; mất lock → `abort()` `lock.signal` + dừng; `release()` dừng watchdog (await in-flight).

- [ ] **Step 1: Write the failing test (fake timers)**

```ts
describe('watchdog auto-renew', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('gia hạn ở nhịp ttl/3 và dừng khi release', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    client.extendLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 3000, { autoRenew: true });
    await jest.advanceTimersByTimeAsync(1000); // ttl/3 = 1000ms
    expect(client.extendLock).toHaveBeenCalledTimes(1);
    await jest.advanceTimersByTimeAsync(1000);
    expect(client.extendLock).toHaveBeenCalledTimes(2);
    await lock?.release();
    await jest.advanceTimersByTimeAsync(5000);
    expect(client.extendLock).toHaveBeenCalledTimes(2); // không gia hạn thêm sau release
  });

  it('mất lock (extend→0): abort signal + dừng watchdog', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(0);
    client.extendLock.mockResolvedValue(0);
    const lock = await service.acquire('job', 3000, { autoRenew: true });
    expect(lock?.signal.aborted).toBe(false);
    await jest.advanceTimersByTimeAsync(1000);
    expect(lock?.signal.aborted).toBe(true);
    await jest.advanceTimersByTimeAsync(3000);
    expect(client.extendLock).toHaveBeenCalledTimes(1); // dừng sau khi mất
    await lock?.release();
  });

  it('extend reject: KHÔNG crash, lên lịch tiếp', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    client.extendLock.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(1);
    const lock = await service.acquire('job', 3000, { autoRenew: true });
    await jest.advanceTimersByTimeAsync(1000);
    await jest.advanceTimersByTimeAsync(1000);
    expect(client.extendLock).toHaveBeenCalledTimes(2); // lần 1 reject, lần 2 vẫn chạy
    expect(lock?.signal.aborted).toBe(false);
    await lock?.release();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- lock.service`
Expected: FAIL — watchdog chưa tồn tại; `extendLock` không được gọi tự động.

- [ ] **Step 3: Add watchdog factory + wire into buildLock**

Thêm hàm module-level (trên class) trong `lock.service.ts`:

```ts
import { Logger } from '@nestjs/common';

const watchdogLogger = new Logger('LockWatchdog');

interface Watchdog {
  stop(): Promise<void>;
}

// Self-scheduling single-flight: chỉ lên lịch lần kế sau khi lần extend hiện tại xong.
function startWatchdog(
  extend: (ms: number) => Promise<boolean>, ttlMs: number, key: string, abort: () => void,
): Watchdog {
  const period = ttlMs / 3; // không floor 1s; ttl>=3000 đã được validate
  let timer: NodeJS.Timeout | null = null;
  let inflight: Promise<void> | null = null;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(run, period);
    timer.unref();
  };

  const run = (): void => {
    inflight = (async () => {
      try {
        const ok = await extend(ttlMs);
        if (!ok) {
          stopped = true;
          abort();
          watchdogLogger.warn(`Mất lock khi auto-renew (key=${key})`);
        }
      } catch (err) {
        watchdogLogger.warn(`extend lỗi (key=${key}): ${(err as Error).message}`);
      }
    })().then(() => {
      inflight = null;
      schedule(); // lên lịch lần kế sau khi xong (single-flight)
    });
  };

  schedule();

  return {
    async stop(): Promise<void> {
      stopped = true;
      if (timer) clearTimeout(timer);
      if (inflight) await inflight; // await lần extend đang chạy → không double-run/leak
    },
  };
}
```

Cập nhật `buildLock` để khởi động/dừng watchdog:

```ts
  private buildLock(
    key: string, lockKey: string, token: string, fencingToken: number | null,
    ttlMs: number, opts?: LockOptions,
  ): Lock {
    const controller = new AbortController();
    const extend = async (ms: number): Promise<boolean> =>
      (await (this.client as any).extendLock(lockKey, token, ms)) === 1;
    const watchdog = opts?.autoRenew
      ? startWatchdog(extend, ttlMs, key, () => controller.abort())
      : null;
    const release = async (): Promise<boolean> => {
      if (watchdog) await watchdog.stop();
      return (await (this.client as any).releaseLock(lockKey, token)) === 1;
    };
    return { key, token, fencingToken, signal: controller.signal, release, extend };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- lock.service`
Expected: PASS (gồm describe `watchdog auto-renew`).

- [ ] **Step 5: Commit**

```bash
git add src/core/redis/services/lock.service.ts test/unit/core/redis/services/lock.service.spec.ts
git commit -m "feat(redis): self-scheduling watchdog auto-renew with abort signal"
```

---

### Task 5: Service holder + RedisModule lifecycle

**Files:**
- Create: `src/core/redis/decorators/with-lock.decorator.ts` (chỉ phần holder ở task này)
- Modify: `src/core/redis/redis.module.ts`
- Test: `test/unit/core/redis/decorators/with-lock.decorator.spec.ts` (phần holder)

**Interfaces:**
- Produces: `setLockServiceRef(s)`, `clearLockServiceRef(s)`, `getLockServiceRef(): LockService`. `RedisModule` set ở `OnModuleInit`, clear ở `OnModuleDestroy`.
- Consumes: `LockService` port từ Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// test/unit/core/redis/decorators/with-lock.decorator.spec.ts
import type { LockService } from '@core/redis/ports/lock.service.port';
import {
  clearLockServiceRef, getLockServiceRef, setLockServiceRef,
} from '@core/redis/decorators/with-lock.decorator';

describe('lock service holder', () => {
  const svcA = {} as LockService;
  const svcB = {} as LockService;
  afterEach(() => clearLockServiceRef(svcA) ?? clearLockServiceRef(svcB));

  it('getLockServiceRef ném khi chưa bootstrap', () => {
    expect(() => getLockServiceRef()).toThrow();
  });

  it('set rồi get trả đúng service', () => {
    setLockServiceRef(svcA);
    expect(getLockServiceRef()).toBe(svcA);
  });

  it('clear bởi đúng chủ sở hữu mới xoá', () => {
    setLockServiceRef(svcA);
    clearLockServiceRef(svcB); // không phải chủ → no-op
    expect(getLockServiceRef()).toBe(svcA);
    clearLockServiceRef(svcA);
    expect(() => getLockServiceRef()).toThrow();
  });

  it('ghi đè bởi context khác → warn (không silent)', () => {
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
    setLockServiceRef(svcA);
    setLockServiceRef(svcB);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- with-lock.decorator`
Expected: FAIL — `Cannot find module '@core/redis/decorators/with-lock.decorator'`.

- [ ] **Step 3: Create holder (decorator added in Task 6)**

```ts
// src/core/redis/decorators/with-lock.decorator.ts
import { Logger } from '@nestjs/common';
import type { LockService } from '../ports/lock.service.port';

const holderLogger = new Logger('WithLock');
let lockServiceRef: LockService | null = null;

export function setLockServiceRef(s: LockService): void {
  if (lockServiceRef && lockServiceRef !== s) {
    holderLogger.warn('LockService ref bị ghi đè bởi context khác (multi-app/test?)');
  }
  lockServiceRef = s;
}

export function clearLockServiceRef(s: LockService): void {
  if (lockServiceRef === s) lockServiceRef = null; // chỉ chủ hiện tại được clear
}

export function getLockServiceRef(): LockService {
  if (!lockServiceRef) {
    throw new Error('LockService chưa được bootstrap — RedisModule phải nạp trước khi dùng @WithLock.');
  }
  return lockServiceRef;
}
```

- [ ] **Step 4: Wire RedisModule lifecycle**

Trong `src/core/redis/redis.module.ts`: thêm `OnModuleInit`, inject `LockService`, set/clear holder.

```ts
import { Global, Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
// ...
import { clearLockServiceRef, setLockServiceRef } from './decorators/with-lock.decorator';
// ...
export class RedisModule implements OnModuleInit, OnModuleDestroy {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
    private readonly lockService: LockService,
  ) {}

  onModuleInit(): void {
    setLockServiceRef(this.lockService);
  }

  async onModuleDestroy(): Promise<void> {
    clearLockServiceRef(this.lockService); // clear TRƯỚC khi đóng client
    await Promise.allSettled([this.client.quit(), this.subscriber.quit()]);
  }
}
```

- [ ] **Step 5: Run test + typecheck**

Run: `pnpm test -- with-lock.decorator`
Expected: PASS.

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/redis/decorators/with-lock.decorator.ts src/core/redis/redis.module.ts test/unit/core/redis/decorators/with-lock.decorator.spec.ts
git commit -m "feat(redis): lock service holder + RedisModule lifecycle wiring"
```

---

### Task 6: `@WithLock` decorator + metadata preservation

**Files:**
- Modify: `src/core/redis/decorators/with-lock.decorator.ts`
- Test: `test/unit/core/redis/decorators/with-lock.decorator.spec.ts`

**Interfaces:**
- Consumes: `getLockServiceRef()`, `LockService.withLock`, `LockOptions`.
- Produces: `WithLock<A extends any[]>(meta): MethodDecorator` — key factory type theo args; copy reflect-metadata sang wrapper.

- [ ] **Step 1: Write the failing test (append)**

```ts
import 'reflect-metadata';
import { WithLock } from '@core/redis/decorators/with-lock.decorator';

describe('@WithLock', () => {
  const withLock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    setLockServiceRef({ withLock } as unknown as LockService);
  });

  it('dựng key qua factory + truyền opts xuống withLock; trả kết quả fn', async () => {
    withLock.mockImplementation(async (_k, _ttl, fn) => fn({ signal: { aborted: false } }));
    class Svc {
      @WithLock({ key: (id: string) => `user:${id}:sync`, ttlMs: 30_000, retry: { waitMs: 5000 } })
      async sync(id: string) { return `synced:${id}`; }
    }
    const out = await new Svc().sync('42');
    expect(out).toBe('synced:42');
    expect(withLock).toHaveBeenCalledWith('user:42:sync', 30_000, expect.any(Function), {
      retry: { waitMs: 5000 }, autoRenew: undefined, onTimeout: undefined,
    });
  });

  it('onTimeout:return → thân method không chạy khi withLock trả undefined', async () => {
    withLock.mockResolvedValue(undefined);
    const body = jest.fn();
    class Svc {
      @WithLock({ key: () => 'k', ttlMs: 5000, onTimeout: 'return' })
      async run() { body(); return 'x'; }
    }
    const out = await new Svc().run();
    expect(out).toBeUndefined();
    expect(body).not.toHaveBeenCalled();
  });

  it('copy reflect-metadata từ method gốc sang wrapper', async () => {
    withLock.mockImplementation(async (_k, _ttl, fn) => fn({}));
    const KEY = 'custom:meta';
    function Marker(): MethodDecorator {
      return (_t, _p, d) => { Reflect.defineMetadata(KEY, 'tagged', d.value as object); return d; };
    }
    class Svc {
      // @WithLock áp NGOÀI (chạy sau) Marker → phải giữ metadata Marker gắn lên hàm gốc
      @WithLock({ key: () => 'k', ttlMs: 5000 })
      @Marker()
      async handler() { return 1; }
    }
    const fn = Object.getOwnPropertyDescriptor(Svc.prototype, 'handler')?.value;
    expect(Reflect.getMetadata(KEY, fn)).toBe('tagged');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test -- with-lock.decorator`
Expected: FAIL — `WithLock` chưa export.

- [ ] **Step 3: Implement the decorator**

Thêm vào cuối `with-lock.decorator.ts`:

```ts
import type { LockOptions } from '../ports/lock.service.port';

export interface WithLockMetadata<A extends any[]> {
  key: (...args: A) => string;
  ttlMs: number;
  retry?: LockOptions['retry'];
  autoRenew?: boolean;
  onTimeout?: 'throw' | 'return';
}

export function WithLock<A extends any[]>(meta: WithLockMetadata<A>): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value;
    function wrapper(this: unknown, ...args: A) {
      const key = meta.key(...args);
      return getLockServiceRef().withLock(
        key, meta.ttlMs, () => original.apply(this, args),
        { retry: meta.retry, autoRenew: meta.autoRenew, onTimeout: meta.onTimeout } as any,
      );
    }
    // BẮT BUỘC: bảo toàn reflect-metadata Nest gắn lên hàm gốc (vd @Cron/@RabbitSubscribe).
    for (const k of Reflect.getMetadataKeys(original)) {
      Reflect.defineMetadata(k, Reflect.getMetadata(k, original), wrapper);
    }
    descriptor.value = wrapper;
    return descriptor;
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test -- with-lock.decorator`
Expected: PASS (gồm 3 case mới + holder).

- [ ] **Step 5: Run full suite + check**

Run: `pnpm test`
Expected: PASS toàn bộ.

Run: `pnpm check`
Expected: Biome format/lint sạch.

- [ ] **Step 6: Commit**

```bash
git add src/core/redis/decorators/with-lock.decorator.ts test/unit/core/redis/decorators/with-lock.decorator.spec.ts
git commit -m "feat(redis): @WithLock decorator with metadata preservation"
```

---

### Task 7: Documentation (CLAUDE.md)

**Files:**
- Modify: `CLAUDE.md` (mục Redis — phần "Lock và RateLimit chạy atomic qua Lua script")

**Interfaces:** none (docs).

- [ ] **Step 1: Update the Redis convention block**

Trong `CLAUDE.md`, mục `### Redis — inject PORT...`, bổ sung sau dòng nói về Lock/RateLimit atomic:

```markdown
- `LockService` hỗ trợ: `acquire`/`withLock` với `opts?` — `retry` (chờ + full-jitter backoff, deadline đơn điệu), `autoRenew` (watchdog self-scheduling, **best-effort liveness KHÔNG phải safety**, yêu cầu `ttlMs ≥ 3000`), `fencing` (**opt-in** — mặc định KHÔNG tạo key `lock:fence:*` để tránh leak; chỉ bật khi thực sự so fencing token ở điểm ghi), `onTimeout: 'throw'|'return'`. `withLock` mặc định throw 409 (overload giữ `Promise<T>`); `onTimeout:'return'` → `Promise<T | undefined>`, KHÔNG chạy fn.
- Lock key business theo format `<domain>:<id>[:<action>]` (vd `user:42:sync`); caller KHÔNG tự thêm `lock:`. Key cardinality cao → để `fencing` off.
- Decorator `@WithLock({ key: (...args) => string, ttlMs, retry?, autoRenew?, onTimeout? })` (từ `@core/redis/decorators/with-lock.decorator`) bọc method service nội bộ; dùng "service holder" set ở vòng đời `RedisModule`. Cần loss-awareness (`lock.signal`) thì dùng `withLock(...)` trực tiếp, KHÔNG dùng decorator.
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): document reusable lock system (retry/watchdog/fencing/@WithLock)"
```

---

## Self-Review

**1. Spec coverage:**
- §2 API surface (LockOptions, Lock, overloads, validation) → Task 2. ✓
- §3 retry (deadline, capped jitter, ≥1 attempt) → Task 3. ✓
- §4.1 extend-lock Lua + §4.4 fencing opt-in Lua → Task 1; fencing in service → Task 2. ✓
- §4.2 watchdog (self-scheduling, single-flight, signal, error handling, cleanup) → Task 4. ✓
- §4.3 manual extend → Task 2. ✓
- §5 holder lifecycle → Task 5; decorator + metadata copy → Task 6. ✓
- §6 key convention/observability/messages → Task 7 (docs) + logger ở Task 4 (`LockWatchdog`). ✓
- §7 file structure → bao phủ Tasks 1–7. ✓
- §8 testing → tests trong mỗi task. ✓
- §9 tương thích (overloads, fencingToken null, consume.ts) → Task 2 step 5 typecheck verify. ✓
- §10 out of scope → không có task (đúng). ✓

**2. Placeholder scan:** Không có TBD/TODO; mọi step code đầy đủ. ✓

**3. Type consistency:** `LockOptions`/`Lock`/`fencingToken: number | null`/`signal: AbortSignal`/`extend(ttlMs)`/`setLockServiceRef`/`clearLockServiceRef`/`getLockServiceRef`/`WithLock`/`startWatchdog` dùng nhất quán xuyên Task 2→6. Lua arg thứ 5 (`'1'|'0'`) khớp giữa Task 1 (script) và Task 2 (gọi). ✓
