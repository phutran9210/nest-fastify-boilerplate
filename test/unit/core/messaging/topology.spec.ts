import { buildExchanges, buildQueues } from '@core/messaging/topology';

const ex = { events: 'app.events', retry: 'app.retry', dlx: 'app.dlx', unrouted: 'app.unrouted' };

describe('topology', () => {
  it('exchanges: events có alternate-exchange, đủ 4 cái', () => {
    const xs = buildExchanges(ex);
    expect(xs.map((x) => x.name).sort()).toEqual([
      'app.dlx',
      'app.events',
      'app.retry',
      'app.unrouted',
    ]);
    const events = xs.find((x) => x.name === 'app.events');
    expect(events?.options?.arguments?.['alternate-exchange']).toBe('app.unrouted');
  });

  it('queues: work quorum + DLX + delivery-limit, retry theo số tier, dlq, unrouted', () => {
    const qs = buildQueues({
      base: 'app',
      exchanges: ex,
      subscriptions: [{ subscriber: 'mail', event: 'user.registered' }],
      retryDelaysMs: [5000, 30000],
      deliveryLimit: 5,
    });
    const work = qs.find((q) => q.name === 'mail.user.registered.q');
    expect(work?.options?.arguments).toMatchObject({
      'x-queue-type': 'quorum',
      'x-dead-letter-exchange': 'app.dlx',
      'x-dead-letter-routing-key': 'user.registered',
      'x-delivery-limit': 5,
    });
    expect(qs.filter((q) => q.name.startsWith('mail.user.registered.retry.'))).toHaveLength(2);
    const retry0 = qs.find((q) => q.name === 'mail.user.registered.retry.0');
    expect(retry0?.options?.arguments).toMatchObject({
      'x-message-ttl': 5000,
      'x-dead-letter-exchange': 'app.events',
      'x-dead-letter-routing-key': 'user.registered',
    });
    expect(qs.some((q) => q.name === 'mail.user.registered.dlq')).toBe(true);
    expect(qs.some((q) => q.name === 'app.unrouted.q')).toBe(true);
  });
});
