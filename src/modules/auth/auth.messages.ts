import type { I18nPath } from '@generated/i18n.generated';

// Khóa i18n của module auth — tránh string literal rải rác, typo bị bắt lúc compile
// (satisfies Record<string, I18nPath>). Thêm message mới: thêm key ở đây + src/i18n/<lang>/auth.json.
export const AuthMessage = {
  EMAIL_TAKEN: 'auth.EMAIL_TAKEN',
  INVALID_CREDENTIALS: 'auth.INVALID_CREDENTIALS',
} as const satisfies Record<string, I18nPath>;
