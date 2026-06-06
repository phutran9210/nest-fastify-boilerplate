import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { RateLimitService } from '@core/redis/ports/rate-limit.service.port';
import { RedisRateLimitService } from '@core/redis/services/rate-limit.service';

describe('RedisRateLimitService', () => {
  const client = { rateLimit: jest.fn() };
  let service: RateLimitService;

  beforeEach(async () => {
    jest.clearAllMocks();
    jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: RateLimitService, useClass: RedisRateLimitService },
        { provide: REDIS_CLIENT, useValue: client },
      ],
    }).compile();
    service = moduleRef.get(RateLimitService);
  });

  it('dưới ngưỡng → allowed=true, remaining từ Lua, resetAt = oldest + window', async () => {
    // oldest = now (vừa add) → resetAt = now + window
    client.rateLimit.mockResolvedValue([1, 4, 1_000_000]);
    const res = await service.hit('login:ip', 5, 60);
    expect(res).toEqual({ allowed: true, remaining: 4, resetAt: 1_000_000 + 60_000 });
    // KEYS rl:<key>; ARGV now, window(ms), limit, member
    expect(client.rateLimit).toHaveBeenCalledWith(
      'rl:login:ip',
      1_000_000,
      60_000,
      5,
      expect.any(String),
    );
  });

  it('bị từ chối → allowed=false, resetAt = oldest_hit + window (sớm hơn now+window)', async () => {
    // oldest = 980_000 → slot sớm nhất rời cửa sổ lúc 980_000 + 60_000 = 1_040_000
    client.rateLimit.mockResolvedValue([0, 0, 980_000]);
    const res = await service.hit('login:ip', 5, 60);
    expect(res.allowed).toBe(false);
    expect(res.remaining).toBe(0);
    expect(res.resetAt).toBe(1_040_000);
  });
});
