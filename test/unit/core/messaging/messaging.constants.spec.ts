import {
  dlqName,
  exchangeNames,
  retryQueueName,
  retryRoutingKey,
  unroutedQueueName,
  workQueueName,
} from '@core/messaging/messaging.constants';

describe('messaging.constants', () => {
  it('exchangeNames suy ra từ base', () => {
    expect(exchangeNames('app')).toEqual({
      events: 'app.events',
      retry: 'app.retry',
      dlx: 'app.dlx',
      unrouted: 'app.unrouted',
    });
  });

  it('tên queue/rk theo subscriber+event', () => {
    expect(workQueueName('mail', 'user.registered')).toBe('mail.user.registered.q');
    expect(retryQueueName('mail', 'user.registered', 1)).toBe('mail.user.registered.retry.1');
    expect(retryRoutingKey('mail', 'user.registered', 1)).toBe('mail.user.registered.r1');
    expect(dlqName('mail', 'user.registered')).toBe('mail.user.registered.dlq');
    expect(unroutedQueueName('app')).toBe('app.unrouted.q');
  });
});
