import { Module } from '@nestjs/common';
import { OutboxRepository } from './outbox.repository.port';
import { PrismaOutboxRepository } from './outbox.repository.prisma';
import { OutboxRelayService } from './outbox-relay.service';

// forProducer: API chỉ cần OutboxRepository. withRelay: worker chạy thêm relay.
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module pattern requires static factory methods on a class
export class OutboxModule {
  static forProducer() {
    return {
      module: OutboxModule,
      providers: [{ provide: OutboxRepository, useClass: PrismaOutboxRepository }],
      exports: [OutboxRepository],
    };
  }

  static withRelay() {
    return {
      module: OutboxModule,
      providers: [
        { provide: OutboxRepository, useClass: PrismaOutboxRepository },
        OutboxRelayService,
      ],
      exports: [OutboxRepository],
    };
  }
}
