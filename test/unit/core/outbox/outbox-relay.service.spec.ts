import { EventPublisherService } from '@core/messaging/event-publisher.service';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import { OutboxRelayService } from '@core/outbox/outbox-relay.service';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

describe('OutboxRelayService', () => {
  let relay: OutboxRelayService;
  const repo = { enqueue: jest.fn(), claimPending: jest.fn(), markPublished: jest.fn(), markFailed: jest.fn() };
  const publisher = { publish: jest.fn() };
  const tx = { run: jest.fn((fn: () => Promise<unknown>) => fn()) };
  const config = {
    getOrThrow: jest.fn((k: string) =>
      ({ RABBITMQ_OUTBOX_POLL_MS: 1000, RABBITMQ_OUTBOX_BATCH: 50, RABBITMQ_OUTBOX_MAX_ATTEMPTS: 10 })[k],
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        OutboxRelayService,
        { provide: OutboxRepository, useValue: repo },
        { provide: EventPublisherService, useValue: publisher },
        { provide: TransactionManager, useValue: tx },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    relay = moduleRef.get(OutboxRelayService);
  });

  it('drain: publish thành công → markPublished', async () => {
    repo.claimPending.mockResolvedValue([
      { id: 'o1', messageId: 'm1', routingKey: 'user.registered', payload: { userId: 'u', email: 'a@b.com' }, requestId: 'r1' },
    ]);
    publisher.publish.mockResolvedValue(undefined);
    await relay.drainOnce();
    expect(publisher.publish).toHaveBeenCalledWith(
      'user.registered',
      { userId: 'u', email: 'a@b.com' },
      { messageId: 'm1', requestId: 'r1' },
    );
    expect(repo.markPublished).toHaveBeenCalledWith('o1');
  });

  it('publish lỗi → markFailed với delay', async () => {
    repo.claimPending.mockResolvedValue([
      { id: 'o2', messageId: 'm2', routingKey: 'user.registered', payload: { userId: 'u', email: 'a@b.com' }, requestId: null },
    ]);
    publisher.publish.mockRejectedValue(new Error('broker down'));
    await relay.drainOnce();
    expect(repo.markFailed).toHaveBeenCalledWith('o2', expect.any(Number), 10);
    expect(repo.markPublished).not.toHaveBeenCalled();
  });
});
