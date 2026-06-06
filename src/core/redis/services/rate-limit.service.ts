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
