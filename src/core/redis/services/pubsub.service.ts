import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { PubSubService } from '../ports/pubsub.service.port';
import { REDIS_CLIENT, REDIS_SUBSCRIBER } from '../redis.constants';

@Injectable()
export class RedisPubSubService extends PubSubService implements OnModuleInit {
  // channel → danh sách handler. Một listener 'message' duy nhất phân phối theo channel.
  private readonly handlers = new Map<string, Array<(message: unknown) => void>>();

  constructor(
    @Inject(REDIS_CLIENT) private readonly client: Redis,
    @Inject(REDIS_SUBSCRIBER) private readonly subscriber: Redis,
  ) {
    super();
  }

  onModuleInit(): void {
    this.subscriber.on('message', (channel: string, payload: string) => {
      const list = this.handlers.get(channel);
      if (!list) return;
      const message: unknown = JSON.parse(payload);
      for (const handler of list) handler(message);
    });
  }

  async publish<T>(channel: string, message: T): Promise<void> {
    await this.client.publish(channel, JSON.stringify(message));
  }

  async subscribe<T>(channel: string, handler: (message: T) => void): Promise<void> {
    const existing = this.handlers.get(channel);
    if (existing) {
      existing.push(handler as (message: unknown) => void);
      return;
    }
    this.handlers.set(channel, [handler as (message: unknown) => void]);
    await this.subscriber.subscribe(channel);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);
    await this.subscriber.unsubscribe(channel);
  }
}
