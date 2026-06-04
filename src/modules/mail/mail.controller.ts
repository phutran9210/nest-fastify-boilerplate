import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../core/decorators/public.decorator';
import { MailProducer } from './mail.producer';

const sendMailSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});
class SendMailDto extends (createZodDto(sendMailSchema) as ReturnType<
  typeof createZodDto<typeof sendMailSchema>
>) {}

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly producer: MailProducer) {}

  @Public()
  @Post('test')
  async test(@Body() dto: SendMailDto) {
    const jobId = await this.producer.enqueue(dto);
    return { enqueued: true, jobId };
  }
}
