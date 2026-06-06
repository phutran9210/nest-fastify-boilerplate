import { randomUUID } from 'node:crypto';
import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Temporal } from '@js-temporal/polyfill';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { exchangeNames, MessagingHeaders } from './messaging.constants';
import { EventContracts, type EventPayload, type EventRoutingKey } from './messaging.contracts';

@Injectable()
export class EventPublisherService {
  private readonly eventsExchange: string;

  constructor(
    private readonly amqp: AmqpConnection,
    config: ConfigService,
  ) {
    this.eventsExchange = exchangeNames(config.getOrThrow<string>('RABBITMQ_EXCHANGE')).events;
  }

  // Publish event đã validate vào exchange chính. await để bắt lỗi confirm.
  async publish<K extends EventRoutingKey>(
    routingKey: K,
    payload: EventPayload<K>,
    opts?: { messageId?: string; requestId?: string },
  ): Promise<void> {
    const validated = EventContracts[routingKey].parse(payload);
    await this.amqp.publish(this.eventsExchange, routingKey, validated, {
      messageId: opts?.messageId ?? randomUUID(),
      timestamp: Temporal.Now.instant().epochMilliseconds,
      contentType: 'application/json',
      headers: {
        [MessagingHeaders.ATTEMPT]: 0,
        [MessagingHeaders.REQUEST_ID]: opts?.requestId,
      },
    });
  }
}
