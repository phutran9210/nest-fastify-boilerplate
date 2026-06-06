import { MessageConsumer } from '@core/messaging/consume';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import { UserRegisteredConsumer } from '@modules/users/consumers/user-registered.consumer';
import { Test } from '@nestjs/testing';

describe('UserRegisteredConsumer', () => {
  let consumer: UserRegisteredConsumer;
  const mail = { enqueue: jest.fn() };
  // MessageConsumer giả: gọi thẳng handler với payload để test logic enqueue mail.
  const messageConsumer = {
    handle: jest.fn((_p, payload, _m, fn) => fn(payload)),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        UserRegisteredConsumer,
        { provide: MailProducer, useValue: mail },
        { provide: MessageConsumer, useValue: messageConsumer },
      ],
    }).compile();
    consumer = moduleRef.get(UserRegisteredConsumer);
  });

  it('enqueue mail với jobId=messageId', async () => {
    const payload = { userId: 'u1', email: 'a@b.com', name: 'A' };
    const amqpMsg = { properties: { messageId: 'mid-9', headers: {} } } as never;
    await consumer.handle(payload, amqpMsg);
    expect(mail.enqueue).toHaveBeenCalledWith(
      { to: 'a@b.com', subject: expect.any(String), body: expect.any(String) },
      'mid-9',
    );
  });
});
