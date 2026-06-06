// Tên AMQP header dùng xuyên producer/relay/consumer.
export const MessagingHeaders = {
  ATTEMPT: 'x-attempt',
  ERROR: 'x-error',
  FAILED_AT: 'x-failed-at',
  REQUEST_ID: 'x-request-id',
} as const;

export function exchangeNames(base: string) {
  return {
    events: `${base}.events`,
    retry: `${base}.retry`,
    dlx: `${base}.dlx`,
    unrouted: `${base}.unrouted`,
  };
}

export const workQueueName = (subscriber: string, event: string) => `${subscriber}.${event}.q`;
export const retryQueueName = (subscriber: string, event: string, tier: number) =>
  `${subscriber}.${event}.retry.${tier}`;
export const retryRoutingKey = (subscriber: string, event: string, tier: number) =>
  `${subscriber}.${event}.r${tier}`;
export const dlqName = (subscriber: string, event: string) => `${subscriber}.${event}.dlq`;
export const unroutedQueueName = (base: string) => `${base}.unrouted.q`;
