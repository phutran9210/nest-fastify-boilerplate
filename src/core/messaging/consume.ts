import { CacheService } from '@core/redis/ports/cache.service.port';
import { LockService } from '@core/redis/ports/lock.service.port';
import { AmqpConnection, Nack } from '@golevelup/nestjs-rabbitmq';
import { Temporal } from '@js-temporal/polyfill';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ConsumeMessage } from 'amqplib';
import { ZodError } from 'zod';
import { exchangeNames, MessagingHeaders, retryRoutingKey } from './messaging.constants';
import { EventContracts, type EventPayload, type EventRoutingKey } from './messaging.contracts';

// Handler PHẢI hoàn tất trong cửa sổ này. Nếu một handler có thể vượt 30s, tăng giá trị này
// hoặc chuyển sang lock có gia hạn (heartbeat). Lock hết hạn giữa chừng → một delivery khác có
// thể chạy song song (chấp nhận được với at-least-once: marker idempotency set sau khi success).
const PROCESSING_LOCK_TTL_MS = 30_000;

export type HandlerFn<K extends EventRoutingKey> = (payload: EventPayload<K>) => Promise<void>;

// err là unknown — tránh `(err as Error).message` ra "undefined" khi ai đó throw non-Error.
function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

@Injectable()
export class MessageConsumer {
  private readonly logger = new Logger(MessageConsumer.name);
  private readonly ex: ReturnType<typeof exchangeNames>;
  private readonly maxRetries: number;
  private readonly idempotencyTtl: number;

  constructor(
    private readonly amqp: AmqpConnection,
    private readonly cache: CacheService,
    private readonly locks: LockService,
    config: ConfigService,
  ) {
    this.ex = exchangeNames(config.getOrThrow<string>('RABBITMQ_EXCHANGE'));
    this.maxRetries = config.getOrThrow<number>('RABBITMQ_MAX_RETRIES');
    this.idempotencyTtl = config.getOrThrow<number>('RABBITMQ_IDEMPOTENCY_TTL');
  }

  // Bọc 1 handler: validate → idempotency → xử lý → retry/DLQ. Trả void (ack) hoặc Nack(requeue).
  async handle<K extends EventRoutingKey>(
    params: { subscriber: string; routingKey: K },
    raw: unknown,
    amqpMsg: ConsumeMessage,
    fn: HandlerFn<K>,
  ): Promise<undefined | Nack> {
    const { subscriber, routingKey } = params;
    // Thiếu messageId → KHÔNG fallback 'unknown' (mọi message thiếu id sẽ đụng chung khóa
    // lock/marker → drop âm thầm). Coi như non-retryable → DLQ.
    const messageId = amqpMsg.properties.messageId;
    if (!messageId) {
      this.logger.warn(`[${routingKey}] thiếu messageId → DLQ`);
      return this.toDlqOrRequeue(routingKey, raw, amqpMsg, 'missing-message-id');
    }
    const doneKey = `messaging:done:${messageId}`;

    // Đã xử lý xong trước đó → ack-skip. (marker luôn là 1; so !== null cho rõ ý.)
    if ((await this.cache.get(doneKey)) !== null) return;

    // Validate: sai schema = non-retryable → thẳng DLQ.
    let payload: EventPayload<K>;
    try {
      payload = EventContracts[routingKey].parse(raw) as EventPayload<K>;
    } catch (e) {
      if (e instanceof ZodError) {
        this.logger.warn(`[${routingKey}] payload sai schema → DLQ (msg=${messageId})`);
        return this.toDlqOrRequeue(routingKey, raw, amqpMsg, 'validation');
      }
      throw e;
    }

    // Lock chống xử lý song song cùng messageId.
    const lock = await this.locks.acquire(`messaging:lock:${messageId}`, PROCESSING_LOCK_TTL_MS);
    if (!lock) return new Nack(true);

    try {
      await fn(payload);
      await this.cache.set(doneKey, 1, this.idempotencyTtl); // chỉ set marker khi thành công
      return;
    } catch (err) {
      this.logger.error(`[${routingKey}] handler lỗi (msg=${messageId}): ${errMsg(err)}`);
      const attempt = Number(amqpMsg.properties.headers?.[MessagingHeaders.ATTEMPT] ?? 0);
      if (attempt < this.maxRetries) {
        return this.toRetryOrRequeue(subscriber, routingKey, payload, amqpMsg, attempt, err);
      }
      return this.toDlqOrRequeue(routingKey, payload, amqpMsg, errMsg(err));
    } finally {
      await lock.release();
    }
  }

  private async toRetryOrRequeue<K extends EventRoutingKey>(
    subscriber: string,
    routingKey: K,
    payload: EventPayload<K>,
    amqpMsg: ConsumeMessage,
    attempt: number,
    err: unknown,
  ): Promise<undefined | Nack> {
    // mỗi attempt 1 tier; clamp về tier cuối khi attempt vượt số tier có sẵn.
    const tier = Math.min(attempt, Math.max(0, this.maxRetries - 1));
    try {
      await this.amqp.publish(
        this.ex.retry,
        retryRoutingKey(subscriber, routingKey, tier),
        payload,
        {
          messageId: amqpMsg.properties.messageId,
          headers: {
            ...(amqpMsg.properties.headers ?? {}),
            [MessagingHeaders.ATTEMPT]: attempt + 1,
            [MessagingHeaders.ERROR]: errMsg(err),
          },
        },
      );
      return; // ack bản gốc
    } catch (pubErr) {
      this.logger.error(`republish retry FAIL → requeue: ${errMsg(pubErr)}`);
      return new Nack(true); // KHÔNG ack: tránh mất message
    }
  }

  // routingKey là string (không phải K): nhánh validation chỉ biết rk thô, chưa parse được payload.
  private async toDlqOrRequeue(
    routingKey: string,
    payload: unknown,
    amqpMsg: ConsumeMessage,
    reason: string,
  ): Promise<undefined | Nack> {
    try {
      await this.amqp.publish(this.ex.dlx, routingKey, payload, {
        messageId: amqpMsg.properties.messageId,
        headers: {
          ...(amqpMsg.properties.headers ?? {}),
          [MessagingHeaders.ERROR]: reason,
          [MessagingHeaders.FAILED_AT]: Temporal.Now.instant().toString(),
        },
      });
      return; // ack bản gốc
    } catch (pubErr) {
      this.logger.error(`publish DLQ FAIL → requeue: ${errMsg(pubErr)}`);
      return new Nack(true);
    }
  }
}
