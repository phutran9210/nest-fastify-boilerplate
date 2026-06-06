import { randomBytes } from 'node:crypto';
import { AppException } from '@common/exceptions/app.exception';
import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type Lock, LockService } from '../ports/lock.service.port';
import { REDIS_CLIENT } from '../redis.constants';
import { RedisMessage } from '../redis.messages';

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
