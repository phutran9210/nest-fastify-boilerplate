import { AmqpConnection } from '@golevelup/nestjs-rabbitmq';
import { Injectable } from '@nestjs/common';

@Injectable()
export class MessagingHealth {
  constructor(private readonly amqp: AmqpConnection) {}

  // golevelup quản managed connection; `connected` phản ánh trạng thái hiện tại.
  status(): 'up' | 'down' {
    return this.amqp.connected ? 'up' : 'down';
  }
}
