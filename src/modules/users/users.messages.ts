import type { I18nPath } from '@generated/i18n.generated';

// Khóa i18n của module users — tránh string literal rải rác, typo bị bắt lúc compile
// (satisfies Record<string, I18nPath>). Thêm message mới: thêm key ở đây + src/i18n/<lang>/users.json.
export const UserMessage = {
  NOT_FOUND: 'users.NOT_FOUND',
  EMAIL_TAKEN: 'users.EMAIL_TAKEN',
} as const satisfies Record<string, I18nPath>;
