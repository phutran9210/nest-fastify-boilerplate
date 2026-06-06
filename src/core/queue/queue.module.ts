import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildRedisBaseOptions } from '../redis/redis.provider';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        // Spread connection identity dùng chung (host/port/password/db). KHÔNG set
        // maxRetriesPerRequest: BullMQ tự ép null cho connection nó own (cần cho blocking
        // command của Worker) — set lại là thừa. KHÔNG áp keyPrefix của app (BullMQ có
        // cơ chế prefix riêng → tránh đổi layout key).
        connection: { ...buildRedisBaseOptions(config) },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
