import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { type RateLimitResult, RateLimitService } from '../ports/rate-limit.service.port';
import { REDIS_CLIENT } from '../redis.constants';

// Redis client kèm custom Lua command `rateLimit` (defineCommand ở redis.provider.ts).
// Khai báo tường minh thay cho cast `any`. Trả [allowed, remaining, oldestTimestamp].
interface RedisRateLimitClient extends Redis {
  rateLimit(
    key: string,
    now: number,
    windowMs: number,
    limit: number,
    member: string,
  ): Promise<[number, number, number]>;
}

@Injectable()
export class RedisRateLimitService extends RateLimitService {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisRateLimitClient) {
    super();
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const windowMs = windowSeconds * 1000;
    const [allowed, remaining, oldest] = await this.client.rateLimit(
      `rl:${key}`,
      now,
      windowMs,
      limit,
      `${now}:${randomUUID()}`,
    );
    return { allowed: allowed === 1, remaining, resetAt: oldest + windowMs };
  }
}
