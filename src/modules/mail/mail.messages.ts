import type { I18nPath } from '@generated/i18n.generated';

// Khóa i18n của module mail — tránh string literal rải rác, typo bị bắt lúc compile
// (satisfies Record<string, I18nPath>). Thêm message mới: thêm key ở đây + src/i18n/<lang>/mail.json.
export const MailMessage = {
  SEND_FAILED: 'mail.SEND_FAILED',
} as const satisfies Record<string, I18nPath>;
