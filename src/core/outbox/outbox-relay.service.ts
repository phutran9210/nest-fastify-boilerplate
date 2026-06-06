import { EventPublisherService } from '@core/messaging/event-publisher.service';
import type { EventPayload, EventRoutingKey } from '@core/messaging/messaging.contracts';
import { TransactionManager } from '@core/prisma/transaction-manager.port';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OutboxRepository } from './outbox.repository.port';

@Injectable()
export class OutboxRelayService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OutboxRelayService.name);
  private readonly pollMs: number;
  private readonly batch: number;
  private readonly maxAttempts: number;
  private timer: NodeJS.Timeout | null = null;
  private stopped = false;

  constructor(
    private readonly repo: OutboxRepository,
    private readonly publisher: EventPublisherService,
    private readonly tx: TransactionManager,
    config: ConfigService,
  ) {
    this.pollMs = config.getOrThrow<number>('RABBITMQ_OUTBOX_POLL_MS');
    this.batch = config.getOrThrow<number>('RABBITMQ_OUTBOX_BATCH');
    this.maxAttempts = config.getOrThrow<number>('RABBITMQ_OUTBOX_MAX_ATTEMPTS');
  }

  onApplicationBootstrap(): void {
    this.scheduleNext();
  }

  onModuleDestroy(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    this.timer = setTimeout(async () => {
      try {
        await this.drainOnce();
      } catch (e) {
        this.logger.error(`outbox drain lỗi: ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        this.scheduleNext();
      }
    }, this.pollMs);
  }

  // Khoá + xử lý 1 batch. Mỗi batch nằm trong 1 transaction để FOR UPDATE SKIP LOCKED có hiệu lực.
  // timeout nới rộng: 1 batch có thể publish tới RABBITMQ_OUTBOX_BATCH message tuần tự → vượt
  // mặc định 5s của Prisma dưới tải/độ trễ broker, gây abort + kẹt forward-progress.
  async drainOnce(): Promise<void> {
    await this.tx.run(
      async () => {
        const rows = await this.repo.claimPending(this.batch);
        for (const row of rows) {
          try {
            await this.publisher.publish(
              row.routingKey as EventRoutingKey,
              row.payload as EventPayload<EventRoutingKey>,
              { messageId: row.messageId, requestId: row.requestId ?? undefined },
            );
            await this.repo.markPublished(row.id);
          } catch (e) {
            this.logger.error(
              `publish outbox ${row.id} lỗi: ${e instanceof Error ? e.message : String(e)}`,
            );
            await this.repo.markFailed(row.id, this.pollMs * 5, this.maxAttempts);
          }
        }
      },
      { timeout: 30_000, maxWait: 5_000 },
    );
  }
}
