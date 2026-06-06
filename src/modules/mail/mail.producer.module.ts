import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailProducer } from './jobs/mail.producer';

// Chỉ producer + queue — KHÔNG controller (để worker import mà không lộ route HTTP mail).
@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  providers: [MailProducer],
  exports: [MailProducer],
})
export class MailProducerModule {}
