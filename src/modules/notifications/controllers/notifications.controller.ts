import { Public } from '@common/decorators/public.decorator';
import { EventPublisherService } from '@core/messaging/event-publisher.service';
import { Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import {
  ApiNotificationPublish,
  ApiNotificationsController,
} from '../decorators/notifications-api.decorator';

@ApiNotificationsController()
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly events: EventPublisherService) {}

  // Event rời (không gắn DB) → publish trực tiếp. Demo producer.
  @Public()
  @Post('publish')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiNotificationPublish()
  async publish() {
    await this.events.publish('notification.created', {
      userId: 'demo',
      message: 'hello from http',
    });
    return { published: true };
  }
}
