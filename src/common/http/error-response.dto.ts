import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.object({ field: z.string(), message: z.string() })).optional(),
  }),
  meta: z.object({
    timestamp: z.string(),
    path: z.string(),
    requestId: z.string(),
  }),
});

export class ErrorResponseDto extends (createZodDto(errorResponseSchema) as ReturnType<
  typeof createZodDto<typeof errorResponseSchema>
>) {}
