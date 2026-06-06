import { MessageConsumer } from '@core/messaging/consume';
import type { UserRegistered } from '@core/messaging/messaging.contracts';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import { Injectable } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';

@Injectable()
export class UserRegisteredConsumer {
  constructor(
    private readonly consumer: MessageConsumer,
    private readonly mail: MailProducer,
  ) {}

  // Subscriber 'mail' nghe 'user.registered' → enqueue BullMQ mail job (chuỗi RMQ → BullMQ).
  @RabbitSubscribe({
    queue: 'mail.user.registered.q',
    createQueueIfNotExists: false,
  })
  handle(msg: unknown, amqpMsg: ConsumeMessage) {
    const messageId = amqpMsg.properties.messageId;
    return this.consumer.handle(
      { subscriber: 'mail', routingKey: 'user.registered' },
      msg,
      amqpMsg,
      async (payload: UserRegistered) => {
        await this.mail.enqueue(
          {
            to: payload.email,
            subject: 'Chào mừng!',
            body: `Xin chào ${payload.name ?? payload.email}, tài khoản của bạn đã sẵn sàng.`,
          },
          messageId,
        );
      },
    );
  }
}
