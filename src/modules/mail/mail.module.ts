import { Module } from '@nestjs/common';
import { MailController } from './controllers/mail.controller';
import { MailProducerModule } from './mail.producer.module';

@Module({
  imports: [MailProducerModule],
  controllers: [MailController],
  exports: [MailProducerModule],
})
export class MailModule {}
