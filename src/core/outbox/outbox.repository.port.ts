import type { EventPayload, EventRoutingKey } from '@core/messaging/messaging.contracts';
import type { OutboxEvent } from '@generated/prisma/client';

export type { OutboxEvent };

export type EnqueueOutboxData<K extends EventRoutingKey = EventRoutingKey> = {
  routingKey: K;
  payload: EventPayload<K>;
  messageId?: string;
  requestId?: string;
};

export abstract class OutboxRepository {
  // Ghi event PENDING — gọi BÊN TRONG TransactionManager.run để atomic với write nghiệp vụ.
  abstract enqueue(data: EnqueueOutboxData): Promise<OutboxEvent>;
  // Lấy & khoá batch PENDING tới hạn (FOR UPDATE SKIP LOCKED) trong 1 transaction.
  abstract claimPending(limit: number): Promise<OutboxEvent[]>;
  abstract markPublished(id: string): Promise<void>;
  abstract markFailed(id: string, retryDelayMs: number, maxAttempts: number): Promise<void>;
}
