import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { CacheService } from '@core/redis/ports/cache.service.port';
import { RedisCacheService } from '@core/redis/services/cache.service';

describe('RedisCacheService', () => {
  const client = { get: jest.fn(), set: jest.fn(), del: jest.fn() };
  const config = { get: jest.fn().mockReturnValue(60) };
  let service: CacheService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: CacheService, useClass: RedisCacheService },
        { provide: REDIS_CLIENT, useValue: client },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(CacheService);
  });

  it('get trả null khi miss', async () => {
    client.get.mockResolvedValue(null);
    expect(await service.get('k')).toBeNull();
    expect(client.get).toHaveBeenCalledWith('cache:k');
  });

  it('get parse JSON khi hit', async () => {
    client.get.mockResolvedValue('{"a":1}');
    expect(await service.get('k')).toEqual({ a: 1 });
  });

  it('set dùng TTL truyền vào (EX)', async () => {
    await service.set('k', { a: 1 }, 30);
    expect(client.set).toHaveBeenCalledWith('cache:k', '{"a":1}', 'EX', 30);
  });

  it('set dùng CACHE_DEFAULT_TTL khi không truyền ttl', async () => {
    await service.set('k', 1);
    expect(client.set).toHaveBeenCalledWith('cache:k', '1', 'EX', 60);
  });

  it('getOrSet gọi factory đúng 1 lần khi miss (GET trả null) rồi cache', async () => {
    client.get.mockResolvedValue(null);
    const factory = jest.fn().mockResolvedValue({ v: 9 });
    const out = await service.getOrSet('k', 30, factory);
    expect(out).toEqual({ v: 9 });
    expect(factory).toHaveBeenCalledTimes(1);
    expect(client.set).toHaveBeenCalledWith('cache:k', '{"v":9}', 'EX', 30);
  });

  it('getOrSet KHÔNG gọi factory khi hit null-đã-cache (GET trả chuỗi "null")', async () => {
    client.get.mockResolvedValue('null');
    const factory = jest.fn();
    const out = await service.getOrSet('k', 30, factory);
    expect(out).toBeNull();
    expect(factory).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });
});
