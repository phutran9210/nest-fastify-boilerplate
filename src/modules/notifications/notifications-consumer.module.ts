import { MessageConsumer } from '@core/messaging/consume';
import { Module } from '@nestjs/common';
import { NotificationsConsumer } from './consumers/notifications.consumer';

// Phía worker: MessagingModule (@Global) cung cấp AmqpConnection; Redis (@Global) cho idempotency.
@Module({
  providers: [MessageConsumer, NotificationsConsumer],
})
export class NotificationsConsumerModule {}
