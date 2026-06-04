import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailProcessor } from './mail.processor';
import { MailProducer } from './mail.producer';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  controllers: [MailController],
  providers: [MailProducer, MailProcessor],
  exports: [MailProducer],
})
export class MailModule {}
