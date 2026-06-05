import { Public } from '@common/decorators/public.decorator';
import { Temporal } from '@js-temporal/polyfill';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiHealthCheck, ApiHealthController } from './decorators/health-api.decorator';

@ApiHealthController()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiHealthCheck()
  check() {
    return { status: 'ok', timestamp: Temporal.Now.instant().toString() };
  }
}
