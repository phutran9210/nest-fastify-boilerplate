import type { I18nPath } from '@generated/i18n.generated';

// Khóa i18n cho module redis (typo bị bắt lúc compile qua satisfies).
export const RedisMessage = {
  LOCK_ACQUISITION_FAILED: 'redis.LOCK_ACQUISITION_FAILED',
} as const satisfies Record<string, I18nPath>;
