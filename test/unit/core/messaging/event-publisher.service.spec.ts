import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { EventPublisherService } from '@core/messaging/event-publisher.service';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';

describe('EventPublisherService', () => {
  let service: EventPublisherService;
  const amqp = { publish: jest.fn().mockResolvedValue(undefined) };
  const config = { getOrThrow: jest.fn().mockReturnValue('app') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        EventPublisherService,
        { provide: AmqpConnection, useValue: amqp },
        { provide: ConfigService, useValue: config },
      ],
    }).compile();
    service = moduleRef.get(EventPublisherService);
  });

  it('publish validate + gửi vào app.events với messageId/headers', async () => {
    const id = '11111111-1111-1111-8111-111111111111'; // RFC 4122 variant (variant nibble = 8)
    await service.publish(
      'user.registered',
      { userId: id, email: 'a@b.com', name: 'A' },
      { messageId: 'mid-1', requestId: 'req-1' },
    );
    expect(amqp.publish).toHaveBeenCalledTimes(1);
    const [exchange, rk, payload, options] = amqp.publish.mock.calls[0];
    expect(exchange).toBe('app.events');
    expect(rk).toBe('user.registered');
    expect(payload).toEqual({ userId: id, email: 'a@b.com', name: 'A' });
    expect(options.messageId).toBe('mid-1');
    expect(options.headers['x-attempt']).toBe(0);
    expect(options.headers['x-request-id']).toBe('req-1');
  });

  it('payload sai contract → ném lỗi, không publish', async () => {
    await expect(
      service.publish('user.registered', { userId: 'not-uuid', email: 'bad' } as never),
    ).rejects.toThrow();
    expect(amqp.publish).not.toHaveBeenCalled();
  });
});
