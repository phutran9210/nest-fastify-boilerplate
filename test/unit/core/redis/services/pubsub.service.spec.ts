import { Test } from '@nestjs/testing';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '@core/redis/redis.constants';
import { PubSubService } from '@core/redis/ports/pubsub.service.port';
import { RedisPubSubService } from '@core/redis/services/pubsub.service';

describe('RedisPubSubService', () => {
  const client = { publish: jest.fn() };
  // subscriber là EventEmitter giả: ghi lại handler 'message' để bắn thủ công.
  let messageHandler: (channel: string, payload: string) => void = () => {};
  const subscriber = {
    subscribe: jest.fn().mockResolvedValue(undefined),
    unsubscribe: jest.fn().mockResolvedValue(undefined),
    on: jest.fn((event: string, cb: any) => {
      if (event === 'message') messageHandler = cb;
    }),
  };
  let service: PubSubService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: PubSubService, useClass: RedisPubSubService },
        { provide: REDIS_CLIENT, useValue: client },
        { provide: REDIS_SUBSCRIBER, useValue: subscriber },
      ],
    }).compile();
    // .compile() KHÔNG chạy lifecycle hook; .init() mới gọi onModuleInit (đăng ký listener 'message').
    await moduleRef.init();
    service = moduleRef.get(PubSubService);
  });

  it('publish gửi JSON qua client', async () => {
    await service.publish('events', { a: 1 });
    expect(client.publish).toHaveBeenCalledWith('events', '{"a":1}');
  });

  it('subscribe đăng ký channel và dispatch handler với message parse', async () => {
    const handler = jest.fn();
    await service.subscribe('events', handler);
    expect(subscriber.subscribe).toHaveBeenCalledWith('events');
    // mô phỏng message tới
    messageHandler('events', '{"a":2}');
    expect(handler).toHaveBeenCalledWith({ a: 2 });
  });

  it('không dispatch handler của channel khác', async () => {
    const handler = jest.fn();
    await service.subscribe('events', handler);
    messageHandler('other', '{"a":3}');
    expect(handler).not.toHaveBeenCalled();
  });
});
