import { MessageConsumer } from '@core/messaging/consume';
import type { NotificationCreated } from '@core/messaging/messaging.contracts';
import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';

@Injectable()
export class NotificationsConsumer {
  private readonly logger = new Logger(NotificationsConsumer.name);

  constructor(private readonly consumer: MessageConsumer) {}

  // Subscriber 'notifications' nghe 'notification.created'. Queue assert tập trung → chỉ attach.
  @RabbitSubscribe({
    queue: 'notifications.notification.created.q',
    createQueueIfNotExists: false,
  })
  handle(msg: unknown, amqpMsg: ConsumeMessage) {
    return this.consumer.handle(
      { subscriber: 'notifications', routingKey: 'notification.created' },
      msg,
      amqpMsg,
      async (payload: NotificationCreated) => {
        this.logger.log(`notification.created user=${payload.userId}: ${payload.message}`);
      },
    );
  }
}
