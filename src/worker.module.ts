import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { CoreConfigModule } from '@core/config/config.module';
import { HealthController } from '@core/health/health.controller';
import { LoggerModule } from '@core/logger/logger.module';
import { QueueModule } from '@core/queue/queue.module';
import { RedisModule } from '@core/redis/redis.module';
import { MailWorkerModule } from '@modules/mail/mail-worker.module';
import { Module } from '@nestjs/common';

// Root module của worker process. Chỉ nạp hạ tầng worker CẦN: config/logger/redis/queue.
// KHÔNG import PrismaModule (không mở kết nối DB) và KHÔNG import MessagingModule (không RMQ).
// Auth Bull Board làm bằng Fastify onRequest hook ở main.worker.ts (không qua Nest middleware).
@Module({
  imports: [
    CoreConfigModule,
    LoggerModule,
    RedisModule,
    QueueModule,
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter }),
    MailWorkerModule,
  ],
  controllers: [HealthController],
})
export class WorkerModule {}
