import { Public } from '@common/decorators/public.decorator';
import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiMailController, ApiMailTest } from '../decorators/mail-api.decorator';
import { SendMailDto } from '../dto/send-mail.dto';
import { MailProducer } from '../jobs/mail.producer';

@ApiMailController()
@Controller('mail')
export class MailController {
  constructor(private readonly producer: MailProducer) {}

  // @Public so the demo can be triggered without a token. Guard this (remove @Public)
  // before exposing a real queue trigger.
  @Public()
  @Post('test')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiMailTest()
  async test(@Body() dto: SendMailDto) {
    const jobId = await this.producer.enqueue(dto);
    return { enqueued: true, jobId };
  }
}
