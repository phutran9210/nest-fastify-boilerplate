import { validateEnv } from '@core/config/env.schema';

function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgres://u:p@localhost:5432/app',
    RABBITMQ_URL: 'amqp://localhost:5672',
    BETTER_AUTH_SECRET: 'test-better-auth-secret-32-chars-min',
    ...overrides,
  };
}

describe('validateEnv — worker fields', () => {
  it('áp default cho WORKER_PORT và MAIL_WORKER_CONCURRENCY', () => {
    const env = validateEnv(baseEnv());
    expect(env.WORKER_PORT).toBe(3001);
    expect(env.MAIL_WORKER_CONCURRENCY).toBe(5);
    expect(env.BULLBOARD_USER).toBe('admin');
  });

  it('cho phép thiếu BULLBOARD_PASSWORD khi KHÔNG phải production', () => {
    const env = validateEnv(baseEnv({ NODE_ENV: 'development' }));
    expect(env.BULLBOARD_PASSWORD).toBeUndefined();
  });

  it('BẮT BUỘC BULLBOARD_PASSWORD khi production', () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: 'production' }))).toThrow(/BULLBOARD_PASSWORD/);
  });

  it('production hợp lệ khi có BULLBOARD_PASSWORD', () => {
    const env = validateEnv(baseEnv({ NODE_ENV: 'production', BULLBOARD_PASSWORD: 'strong' }));
    expect(env.BULLBOARD_PASSWORD).toBe('strong');
  });
});
