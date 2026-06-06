import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  // Pino log level. Không set → suy ra theo NODE_ENV (debug ở dev, info ở prod) tại LoggerModule.
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).optional(),
  // Ghi log ra file (ngoài console) hay không.
  LOG_FILE_ENABLED: z.stringbool().default(false),
  // Ghi thêm file CHỈ chứa lỗi (level >= error) — độc lập với LOG_FILE_ENABLED.
  LOG_ERROR_FILE_ENABLED: z.stringbool().default(false),
  // Thư mục chứa file log (khi bật ghi file).
  LOG_DIR: z.string().default('logs'),
  // Số file log giữ lại — xoay theo ngày/size, giữ N file gần nhất (mặc định 30).
  LOG_FILE_MAX_DAYS: z.coerce.number().int().positive().default(30),
  // Kích thước tối đa mỗi file — xoay khi vượt (vd 50m, 1g; số trần = bytes). Mặc định 50m.
  LOG_FILE_MAX_SIZE: z
    .string()
    .regex(/^\d+[kmg]?$/i, 'LOG_FILE_MAX_SIZE phải dạng số + đơn vị k/m/g (vd 50m)')
    .default('50m'),

  DATABASE_URL: z.url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  REDIS_DB: z.coerce.number().int().min(0).default(0),
  REDIS_KEY_PREFIX: z.string().default('app:'),
  CACHE_DEFAULT_TTL: z.coerce.number().int().positive().default(60), // giây

  RABBITMQ_URL: z.url(),
  RABBITMQ_QUEUE: z.string().default('notifications_queue'),

  JWT_SECRET: z.string().min(8),
  // Seconds until the access token expires (jsonwebtoken accepts a number of seconds).
  JWT_EXPIRES_IN: z.coerce.number().int().positive().default(3600),

  // Ngôn ngữ fallback của nestjs-i18n khi không resolve được locale hoặc thiếu bản dịch.
  FALLBACK_LANGUAGE: z.string().default('vi'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
