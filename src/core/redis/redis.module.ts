import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { CacheService } from './ports/cache.service.port';
import { LockService } from './ports/lock.service.port';
import { PubSubService } from './ports/pubsub.service.port';
import { RateLimitService } from './ports/rate-limit.service.port';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from './redis.constants';
import { createRedisClient, createRedisSubscriber } from './redis.provider';
import { RedisCacheService } from './services/cache.service';
import { RedisLockService } from './services/lock.service';
import { RedisPubSubService } from './services/pubsub.service';
import { RedisRateLimitService } from './services/rate-limit.service';

@Global()
@Module({
  providers: [
    { provide: REDIS_CLIENT, inject: [ConfigService], useFactory: createRedisClient },
    { provide: REDIS_SUBSCRIBER, inject: [ConfigService], useFactory: createRedisSubscriber },
    { provide: CacheService, useClass: RedisCacheService },
    { provide: LockService, useClass: RedisLockService },
    { provide: RateLimitService, useClass: RedisRateLimitService },
    { provide: PubSubService, useClass: RedisPubSubService },
  ],
  exports: [
    REDIS_CLIENT,
    REDIS_SUBSCRIBER,
    CacheService,
    LockService,
    RateLimitService,
    PubSubService,
  ],
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
