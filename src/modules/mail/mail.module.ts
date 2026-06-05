import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailController } from './controllers/mail.controller';
import { MailProcessor } from './jobs/mail.processor';
import { MailProducer } from './jobs/mail.producer';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  controllers: [MailController],
  providers: [MailProducer, MailProcessor],
  exports: [MailProducer],
})
export class MailModule {}
