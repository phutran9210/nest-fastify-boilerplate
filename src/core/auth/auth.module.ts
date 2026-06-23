import { OutboxModule } from '@core/outbox/outbox.module';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { PrismaService } from '@core/prisma/prisma.service';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import { MailProducerModule } from '@modules/mail/mail.producer.module';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_INSTANCE, createAuth } from './auth';

@Global()
@Module({
  imports: [MailProducerModule, OutboxModule.forProducer()],
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [PrismaService, MailProducer, OutboxRepository, ConfigService],
      useFactory: (
        prisma: PrismaService,
        mail: MailProducer,
        outbox: OutboxRepository,
        config: ConfigService,
      ) => createAuth({ prisma, mail, outbox, config }),
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class BetterAuthModule {}
