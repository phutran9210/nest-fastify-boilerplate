import { RabbitMQModule } from '@golevelup/nestjs-rabbitmq';
import { type DynamicModule, Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventPublisherService } from './event-publisher.service';
import { exchangeNames } from './messaging.constants';
import { SUBSCRIPTIONS } from './messaging.contracts';
import { MessagingHealth } from './messaging.health';
import { buildExchanges, buildQueues } from './topology';

@Global()
@Module({})
// biome-ignore lint/complexity/noStaticOnlyClass: NestJS dynamic module pattern requires static factory methods on a class
export class MessagingModule {
  // consumer=false: API (producer-only, registerHandlers:false). consumer=true: worker.
  static forRoot(opts: { consumer: boolean }): DynamicModule {
    return {
      module: MessagingModule,
      imports: [
        RabbitMQModule.forRootAsync({
          inject: [ConfigService],
          useFactory: (config: ConfigService) => {
            const base = config.getOrThrow<string>('RABBITMQ_EXCHANGE');
            const ex = exchangeNames(base);
            const retryDelaysMs = config.getOrThrow<number[]>('RABBITMQ_RETRY_DELAYS_MS');
            const deliveryLimit = config.getOrThrow<number>('RABBITMQ_QUORUM_DELIVERY_LIMIT');
            return {
              uri: config.getOrThrow<string>('RABBITMQ_URL'),
              exchanges: buildExchanges(ex),
              queues: buildQueues({
                base,
                exchanges: ex,
                subscriptions: SUBSCRIPTIONS,
                retryDelaysMs,
                deliveryLimit,
              }),
              channels: {
                default: {
                  prefetchCount: config.getOrThrow<number>('RABBITMQ_PREFETCH'),
                  default: true,
                },
              },
              connectionInitOptions: { wait: false },
              defaultPublishOptions: { persistent: true },
              registerHandlers: opts.consumer,
            };
          },
        }),
      ],
      providers: [EventPublisherService, MessagingHealth],
      exports: [EventPublisherService, MessagingHealth, RabbitMQModule],
    };
  }
}
