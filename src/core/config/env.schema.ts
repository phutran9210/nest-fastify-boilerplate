import { z } from 'zod';

export const envSchema = z
  .object({
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
    RABBITMQ_EXCHANGE: z.string().default('app'),
    RABBITMQ_PREFETCH: z.coerce.number().int().positive().default(10),
    RABBITMQ_MAX_RETRIES: z.coerce.number().int().min(0).default(3),
    // CSV milliseconds, mỗi phần tử = 1 retry tier (5s, 30s, 5m).
    RABBITMQ_RETRY_DELAYS_MS: z
      .string()
      .default('5000,30000,300000')
      .transform((s) => s.split(',').map((n) => Number(n.trim())))
      .refine((arr) => arr.length > 0 && arr.every((n) => Number.isInteger(n) && n > 0), {
        message: 'RABBITMQ_RETRY_DELAYS_MS phải là danh sách số ms dương, cách nhau bằng dấu phẩy',
      }),
    RABBITMQ_QUORUM_DELIVERY_LIMIT: z.coerce.number().int().positive().default(5),
    RABBITMQ_IDEMPOTENCY_TTL: z.coerce.number().int().positive().default(86400), // giây
    RABBITMQ_OUTBOX_POLL_MS: z.coerce.number().int().positive().default(1000),
    RABBITMQ_OUTBOX_BATCH: z.coerce.number().int().positive().default(50),
    RABBITMQ_OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().positive().default(10),

    // ── Better Auth ───────────────────────────────────────────────────────
    // Server secret for signing sessions/tokens. Min 32 chars.
    BETTER_AUTH_SECRET: z.string().min(32),
    // Public base URL where the API (and /api/auth) is reachable.
    BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
    // Require email verification before sign-in. Defaults ON (prod-safe); set false in dev .env.
    EMAIL_VERIFICATION_REQUIRED: z.stringbool().default(true),
    // CSV of trusted origins used by CORS and Better Auth. Empty means Better Auth trusts only
    // BETTER_AUTH_URL (same-origin by default); list extra frontend origins explicitly.
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(',')
              .map((o) => o.trim())
              .filter(Boolean)
          : [],
      ),
    // CSV of user ids always treated as admin (Better Auth `adminUserIds` + Nest RolesGuard).
    ADMIN_USER_IDS: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      ),
    // Social providers — each registered only if BOTH id+secret are present.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),

    // Ngôn ngữ fallback của nestjs-i18n khi không resolve được locale hoặc thiếu bản dịch.
    FALLBACK_LANGUAGE: z.string().default('vi'),

    // ── Worker process (BullMQ) ────────────────────────────────────────────
    // Cổng HTTP của worker process (health + Bull Board). Độc lập với PORT của API.
    WORKER_PORT: z.coerce.number().int().positive().default(3001),
    // Số job chạy song song của worker mail.
    MAIL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
    // Basic Auth cho Bull Board UI.
    BULLBOARD_USER: z.string().default('admin'),
    // KHÔNG default — tránh credential mặc định lọt vào production (worker bind 0.0.0.0).
    // Bắt buộc ở production qua superRefine bên dưới.
    BULLBOARD_PASSWORD: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    // Bull Board lộ payload job → ở production không cho phép thiếu mật khẩu.
    if (env.NODE_ENV === 'production' && !env.BULLBOARD_PASSWORD) {
      ctx.addIssue({
        code: 'custom',
        path: ['BULLBOARD_PASSWORD'],
        message: 'BULLBOARD_PASSWORD là bắt buộc ở production.',
      });
    }
    // Mỗi attempt cần 1 retry-tier queue (đã khai báo theo độ dài RETRY_DELAYS_MS). Nếu
    // MAX_RETRIES > số tier, consumer sẽ publish vào routing key chưa có queue → message lọt
    // alternate-exchange (unrouted), mất luồng retry/DLQ. Fail-fast lúc boot.
    if (env.RABBITMQ_RETRY_DELAYS_MS.length < env.RABBITMQ_MAX_RETRIES) {
      ctx.addIssue({
        code: 'custom',
        path: ['RABBITMQ_RETRY_DELAYS_MS'],
        message: `RABBITMQ_RETRY_DELAYS_MS phải có ít nhất RABBITMQ_MAX_RETRIES (${env.RABBITMQ_MAX_RETRIES}) phần tử.`,
      });
    }
    // A social provider needs BOTH id and secret, or neither.
    const pairs: Array<[string, string, string]> = [
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'Google'],
      ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET', 'Facebook'],
    ];
    for (const [idKey, secretKey, label] of pairs) {
      const id = env[idKey as keyof typeof env];
      const secret = env[secretKey as keyof typeof env];
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: 'custom',
          path: [id ? secretKey : idKey],
          message: `${label} OAuth needs both id and secret, or neither.`,
        });
      }
    }
  });

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}
