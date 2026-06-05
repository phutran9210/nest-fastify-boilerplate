import type { I18nPath } from '@generated/i18n.generated';

// Khóa i18n dùng chung (cross-cutting) — tránh string literal rải rác, typo bị bắt lúc compile
// (satisfies Record<string, I18nPath>). Thêm message mới: thêm key ở đây + src/i18n/<lang>/common.json.
export const CommonMessage = {
  INTERNAL_ERROR: 'common.INTERNAL_ERROR',
  VALIDATION_FAILED: 'common.VALIDATION_FAILED',
} as const satisfies Record<string, I18nPath>;
