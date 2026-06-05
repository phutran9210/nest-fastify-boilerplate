import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const sendMailSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export class SendMailDto extends (createZodDto(sendMailSchema) as ReturnType<
  typeof createZodDto<typeof sendMailSchema>
>) {}
