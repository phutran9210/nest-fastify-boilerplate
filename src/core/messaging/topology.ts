import type { RabbitMQExchangeConfig, RabbitMQQueueConfig } from '@golevelup/nestjs-rabbitmq';
import {
  dlqName,
  retryQueueName,
  retryRoutingKey,
  unroutedQueueName,
  workQueueName,
} from './messaging.constants';

type Exchanges = { events: string; retry: string; dlx: string; unrouted: string };

export function buildExchanges(ex: Exchanges): RabbitMQExchangeConfig[] {
  return [
    {
      name: ex.events,
      type: 'topic',
      // Message không khớp binding nào → đẩy sang alternate-exchange thay vì bị drop.
      options: { durable: true, arguments: { 'alternate-exchange': ex.unrouted } },
    },
    { name: ex.retry, type: 'topic', options: { durable: true } },
    { name: ex.dlx, type: 'topic', options: { durable: true } },
    { name: ex.unrouted, type: 'fanout', options: { durable: true } },
  ];
}

export function buildQueues(params: {
  base: string;
  exchanges: Exchanges;
  subscriptions: ReadonlyArray<{ subscriber: string; event: string }>;
  retryDelaysMs: number[];
  deliveryLimit: number;
}): RabbitMQQueueConfig[] {
  const { base, exchanges: ex, subscriptions, retryDelaysMs, deliveryLimit } = params;

  // Queue bắt message unroutable (alternate-exchange fanout).
  const queues: RabbitMQQueueConfig[] = [
    {
      name: unroutedQueueName(base),
      exchange: ex.unrouted,
      routingKey: '',
      createQueueIfNotExists: true,
      options: { durable: true, arguments: { 'x-queue-type': 'quorum' } },
    },
  ];

  for (const { subscriber, event } of subscriptions) {
    // Work queue: quorum + DLX + delivery-limit (backstop crash-loop).
    queues.push({
      name: workQueueName(subscriber, event),
      exchange: ex.events,
      routingKey: event,
      createQueueIfNotExists: true,
      options: {
        durable: true,
        arguments: {
          'x-queue-type': 'quorum',
          'x-dead-letter-exchange': ex.dlx,
          'x-dead-letter-routing-key': event,
          'x-delivery-limit': deliveryLimit,
        },
      },
    });

    // Retry-tier queues: durable classic, TTL → dead-letter về events exchange.
    retryDelaysMs.forEach((ttl, i) => {
      queues.push({
        name: retryQueueName(subscriber, event, i),
        exchange: ex.retry,
        routingKey: retryRoutingKey(subscriber, event, i),
        createQueueIfNotExists: true,
        options: {
          durable: true,
          arguments: {
            'x-message-ttl': ttl,
            'x-dead-letter-exchange': ex.events,
            'x-dead-letter-routing-key': event,
          },
        },
      });
    });

    // DLQ: quorum, parking lot.
    queues.push({
      name: dlqName(subscriber, event),
      exchange: ex.dlx,
      routingKey: event,
      createQueueIfNotExists: true,
      options: { durable: true, arguments: { 'x-queue-type': 'quorum' } },
    });
  }

  return queues;
}
