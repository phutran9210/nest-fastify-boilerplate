import { MessageConsumer } from '@core/messaging/consume';
import { MailProducerModule } from '@modules/mail/mail.producer.module';
import { Module } from '@nestjs/common';
import { UserRegisteredConsumer } from './consumers/user-registered.consumer';

// Phía worker: cần MailProducer để enqueue job. MessagingModule/Redis là @Global.
@Module({
  imports: [MailProducerModule],
  providers: [MessageConsumer, UserRegisteredConsumer],
})
export class UsersConsumerModule {}
