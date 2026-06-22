import { randomBytes } from 'node:crypto';
import { AppException } from '@common/exceptions/app.exception';
import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type Lock, type LockOptions, LockService } from '../ports/lock.service.port';
import { REDIS_CLIENT } from '../redis.constants';
import { RedisMessage } from '../redis.messages';

// Redis client kèm custom Lua command đăng ký qua defineCommand (redis.provider.ts).
// ioredis không sinh type cho command tự định nghĩa nên ta khai báo tường minh ở đây
// (thay cho cast `any`). acquireLock trả null khi đã bị giữ (Lua `false` → nil → null).
interface RedisLockClient extends Redis {
  acquireLock(
    lockKey: string,
    fenceKey: string,
    token: string,
    ttlMs: number,
    fencing: '0' | '1',
  ): Promise<number | null>;
  extendLock(lockKey: string, token: string, ttlMs: number): Promise<number>;
  releaseLock(lockKey: string, token: string): Promise<number>;
}

const watchdogLogger = new Logger('LockWatchdog');

interface Watchdog {
  stop(): Promise<void>;
}

// Self-scheduling single-flight: chỉ lên lịch lần kế sau khi lần extend hiện tại xong.
function startWatchdog(
  extend: (ms: number) => Promise<boolean>,
  ttlMs: number,
  key: string,
  abort: () => void,
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

function validateLockArgs(ttlMs: number, opts?: LockOptions): void {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) {
    throw new Error(`LockService: ttlMs phải > 0 (nhận ${ttlMs})`);
  }
  if (opts?.retry) {
    const { waitMs, minDelayMs = 50, maxDelayMs = 400 } = opts.retry;
    if (!Number.isFinite(waitMs) || waitMs < 0)
      throw new Error('LockService: retry.waitMs phải >= 0');
    if (!Number.isFinite(minDelayMs) || minDelayMs <= 0)
      throw new Error('LockService: retry.minDelayMs phải > 0');
    if (!Number.isFinite(maxDelayMs) || maxDelayMs < minDelayMs)
      throw new Error('LockService: retry.maxDelayMs phải >= minDelayMs');
  }
  if (opts?.autoRenew && ttlMs < 3000) {
    throw new Error('LockService: autoRenew yêu cầu ttlMs >= 3000ms để watchdog an toàn');
  }
}

@Injectable()
export class RedisLockService extends LockService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisLockClient) {
    super();
  }

  async acquire(key: string, ttlMs: number, opts?: LockOptions): Promise<Lock | null> {
    validateLockArgs(ttlMs, opts);
    const fencing = opts?.fencing ?? false;
    const lockKey = `lock:${key}`;
    const fenceKey = `lock:fence:${key}`;

    const tryOnce = async (): Promise<{ token: string; fencingToken: number | null } | null> => {
      const token = randomBytes(20).toString('hex');
      const res = await this.client.acquireLock(
        lockKey,
        fenceKey,
        token,
        ttlMs,
        fencing ? '1' : '0',
      );
      if (res === null) return null;
      return { token, fencingToken: fencing ? res : null };
    };

    let got = await tryOnce();
    if (!got && opts?.retry) got = await this.retryAcquire(tryOnce, opts.retry);
    if (!got) return null;
    return this.buildLock(key, lockKey, got.token, got.fencingToken, ttlMs, opts);
  }

  // overloads khai báo ở port; impl dùng signature rộng.
  async withLock<T>(
    key: string,
    ttlMs: number,
    fn: (lock: Lock) => Promise<T>,
    opts?: LockOptions,
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

  private buildLock(
    key: string,
    lockKey: string,
    token: string,
    fencingToken: number | null,
    ttlMs: number,
    opts?: LockOptions,
  ): Lock {
    const controller = new AbortController();
    const extend = async (ms: number): Promise<boolean> =>
      (await this.client.extendLock(lockKey, token, ms)) === 1;
    const watchdog = opts?.autoRenew
      ? startWatchdog(extend, ttlMs, key, () => controller.abort())
      : null;
    const release = async (): Promise<boolean> => {
      if (watchdog) await watchdog.stop();
      return (await this.client.releaseLock(lockKey, token)) === 1;
    };
    return { key, token, fencingToken, signal: controller.signal, release, extend };
  }
}
