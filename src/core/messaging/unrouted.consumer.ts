import { RabbitSubscribe } from '@golevelup/nestjs-rabbitmq';
import { Injectable, Logger } from '@nestjs/common';
import type { ConsumeMessage } from 'amqplib';

// Chạy ở worker. Bắt message không khớp binding nào (qua alternate-exchange).
// queue đã được assert tập trung (topology.ts) → chỉ attach consumer.
@Injectable()
export class UnroutedConsumer {
  private readonly logger = new Logger(UnroutedConsumer.name);

  @RabbitSubscribe({
    queue: `${process.env.RABBITMQ_EXCHANGE ?? 'app'}.unrouted.q`,
    createQueueIfNotExists: false,
  })
  handle(_msg: unknown, amqpMsg: ConsumeMessage): void {
    this.logger.error(
      `Unrouted message rk=${amqpMsg.fields.routingKey} msg=${amqpMsg.properties.messageId} — thiếu binding/cấu hình sai`,
    );
  }
}
