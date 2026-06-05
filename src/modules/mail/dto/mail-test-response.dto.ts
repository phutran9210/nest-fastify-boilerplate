import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Shape tra ve cua POST /mail/test: { enqueued: true, jobId } — xem mail.controller.ts.
export const mailTestResponseSchema = z.object({
  enqueued: z.boolean(),
  jobId: z.string(),
});

export class MailTestResponseDto extends (createZodDto(mailTestResponseSchema) as ReturnType<
  typeof createZodDto<typeof mailTestResponseSchema>
>) {}
