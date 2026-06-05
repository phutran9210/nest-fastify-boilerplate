import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SendMailDto } from '../dto/send-mail.dto';
import { MailProducer } from '../jobs/mail.producer';

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly producer: MailProducer) {}

  // @Public so the demo can be triggered without a token. Guard this (remove @Public)
  // before exposing a real queue trigger.
  @Public()
  @Post('test')
  async test(@Body() dto: SendMailDto) {
    const jobId = await this.producer.enqueue(dto);
    return { enqueued: true, jobId };
  }
}
