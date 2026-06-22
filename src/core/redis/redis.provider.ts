import type { ConfigService } from '@nestjs/config';
import { Redis, type RedisOptions } from 'ioredis';
import { acquireLock } from './scripts/acquire-lock.lua';
import { extendLock } from './scripts/extend-lock.lua';
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
  client.defineCommand('extendLock', extendLock);
  client.defineCommand('rateLimit', rateLimit);
  return client;
}

// Subscriber riêng: vào subscriber mode nên không dùng cho command thường.
export function createRedisSubscriber(config: ConfigService): Redis {
  return new Redis({ ...appOptions(config), maxRetriesPerRequest: null });
}
