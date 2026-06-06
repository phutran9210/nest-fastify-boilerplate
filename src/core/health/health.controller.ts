import { Public } from '@common/decorators/public.decorator';
import { MessagingHealth } from '@core/messaging/messaging.health';
import { Temporal } from '@js-temporal/polyfill';
import { Controller, Get, HttpCode, HttpStatus, Inject } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { ApiHealthCheck, ApiHealthController } from './decorators/health-api.decorator';

@ApiHealthController()
@Controller('health')
export class HealthController {
  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    private readonly messaging: MessagingHealth,
  ) {}

  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiHealthCheck()
  async check() {
    return {
      status: 'ok',
      timestamp: Temporal.Now.instant().toString(),
      redis: await this.pingRedis(),
      rabbitmq: this.messaging.status(),
    };
  }

  // ping() có thể treo: lazyConnect + offline queue khiến lệnh chờ/retry khi Redis chưa sẵn sàng.
  // Race với timeout ngắn → trả 'down' thay vì giữ request. (Liveness check không được block.)
  private async pingRedis(): Promise<'up' | 'down'> {
    const timeout = new Promise<'down'>((resolve) => setTimeout(() => resolve('down'), 500));
    const ping = this.redis
      .ping()
      .then((r): 'up' | 'down' => (r === 'PONG' ? 'up' : 'down'))
      .catch(() => 'down' as const);
    return Promise.race([ping, timeout]);
  }
}
