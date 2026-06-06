// PORT cache-aside. abstract class = DI token + type. Impl: services/cache.service.ts.
export abstract class CacheService {
  abstract get<T>(key: string): Promise<T | null>;
  abstract set<T>(key: string, value: T, ttlSeconds?: number): Promise<void>;
  abstract del(key: string): Promise<void>;
  // miss → chạy factory → cache. Một GET phân biệt được: miss = JS null, null-đã-cache = chuỗi 'null'.
  abstract getOrSet<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T>;
}
