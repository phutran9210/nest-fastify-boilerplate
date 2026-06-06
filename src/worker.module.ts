import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { CoreConfigModule } from '@core/config/config.module';
import { HealthController } from '@core/health/health.controller';
import { LoggerModule } from '@core/logger/logger.module';
import { MessagingModule } from '@core/messaging/messaging.module';
import { UnroutedConsumer } from '@core/messaging/unrouted.consumer';
import { OutboxModule } from '@core/outbox/outbox.module';
import { PrismaModule } from '@core/prisma/prisma.module';
import { QueueModule } from '@core/queue/queue.module';
import { RedisModule } from '@core/redis/redis.module';
import { MailWorkerModule } from '@modules/mail/mail-worker.module';
import { NotificationsConsumerModule } from '@modules/notifications/notifications-consumer.module';
import { UsersConsumerModule } from '@modules/users/users-consumer.module';
import { Module } from '@nestjs/common';

// Worker process: chạy BullMQ processors + RMQ consumers + outbox relay.
// KHÁC trước: nay CÓ PrismaModule (outbox/consumers cần DB) + MessagingModule (consumer mode).
@Module({
  imports: [
    CoreConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    MessagingModule.forRoot({ consumer: true }),
    OutboxModule.withRelay(),
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter }),
    MailWorkerModule,
    NotificationsConsumerModule,
    UsersConsumerModule,
  ],
  controllers: [HealthController],
  providers: [UnroutedConsumer],
})
export class WorkerModule {}
