import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailController } from './controllers/mail.controller';
import { MailProducer } from './jobs/mail.producer';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  controllers: [MailController],
  providers: [MailProducer],
  exports: [MailProducer],
})
export class MailModule {}
