import { buildRedisBaseOptions } from '@core/redis/redis.provider';

function fakeConfig(values: Record<string, unknown>) {
  return {
    getOrThrow: (k: string) => values[k],
    get: (k: string) => values[k],
  } as any;
}

describe('buildRedisBaseOptions', () => {
  it('maps host/port/password/db từ config', () => {
    const opts = buildRedisBaseOptions(
      fakeConfig({ REDIS_HOST: 'h', REDIS_PORT: 6379, REDIS_PASSWORD: 'pw', REDIS_DB: 2 }),
    );
    expect(opts).toEqual({ host: 'h', port: 6379, password: 'pw', db: 2 });
  });

  it('db mặc định 0 khi config trả undefined', () => {
    const opts = buildRedisBaseOptions(fakeConfig({ REDIS_HOST: 'h', REDIS_PORT: 6379 }));
    expect(opts.db).toBe(0);
    expect(opts.password).toBeUndefined();
  });
});
