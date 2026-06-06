import { EventContracts, userRegisteredSchema } from '@core/messaging/messaging.contracts';

describe('messaging.contracts', () => {
  it('user.registered chấp nhận payload đủ và thiếu name (optional)', () => {
    expect(() =>
      userRegisteredSchema.parse({ userId: crypto.randomUUID(), email: 'a@b.com', name: 'A' }),
    ).not.toThrow();
    expect(() =>
      userRegisteredSchema.parse({ userId: crypto.randomUUID(), email: 'a@b.com' }),
    ).not.toThrow();
  });

  it('user.registered từ chối email sai', () => {
    expect(() =>
      userRegisteredSchema.parse({ userId: crypto.randomUUID(), email: 'nope', name: 'A' }),
    ).toThrow();
  });

  it('registry có cả 2 routing key', () => {
    expect(Object.keys(EventContracts).sort()).toEqual([
      'notification.created',
      'user.registered',
    ]);
  });
});
