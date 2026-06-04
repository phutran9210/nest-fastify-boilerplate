import { Controller, Inject, Logger, Post } from '@nestjs/common';
import { type ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../core/decorators/public.decorator';
import { RMQ_CLIENT } from '../../../core/messaging/messaging.module';

interface NotificationCreated {
  userId: string;
  message: string;
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(@Inject(RMQ_CLIENT) private readonly client: ClientProxy) {}

  // HTTP endpoint that publishes an event to RabbitMQ (demo producer).
  @Public()
  @Post('publish')
  publish() {
    const payload: NotificationCreated = { userId: 'demo', message: 'hello from http' };
    // emit() returns a cold Observable — subscribe so the message is actually sent.
    this.client.emit('notification.created', payload).subscribe();
    return { published: true };
  }

  // RabbitMQ consumer (demo). Runs in the attached microservice. No @Public() needed:
  // JwtAuthGuard skips non-HTTP contexts (see core/guards/jwt-auth.guard.ts).
  @EventPattern('notification.created')
  handleCreated(@Payload() data: NotificationCreated): void {
    this.logger.log(`Received notification.created for user=${data.userId}: ${data.message}`);
  }
}
