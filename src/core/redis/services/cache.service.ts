import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis.constants';
import { CacheService } from '../ports/cache.service.port';

@Injectable()
export class RedisCacheService extends CacheService {
  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    private readonly config: ConfigService,
  ) {
    super();
  }

  private key(key: string): string {
    return `cache:${key}`;
  }

  private ttl(ttlSeconds?: number): number {
    return ttlSeconds ?? this.config.get<number>('CACHE_DEFAULT_TTL') ?? 60;
  }

  async get<T>(key: string): Promise<T | null> {
    const raw = await this.client.get(this.key(key));
    return raw === null ? null : (JSON.parse(raw) as T);
  }

  async set<T>(key: string, value: T, ttlSeconds?: number): Promise<void> {
    await this.client.set(this.key(key), JSON.stringify(value), 'EX', this.ttl(ttlSeconds));
  }

  async del(key: string): Promise<void> {
    await this.client.del(this.key(key));
  }

  async getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const full = this.key(key);
    // Một GET, không race: miss = JS null; null-đã-cache = chuỗi 'null' → parse ra null (hit).
    const raw = await this.client.get(full);
    if (raw !== null) return JSON.parse(raw) as T;
    const value = await factory();
    await this.client.set(full, JSON.stringify(value), 'EX', ttlSeconds);
    return value;
  }
}
