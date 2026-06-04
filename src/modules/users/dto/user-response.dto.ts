import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const userResponseSchema = z.object({
  id: z.string(),
  email: z.email(),
  name: z.string().nullable(),
  createdAt: z.any().transform((v: unknown) => (v instanceof Date ? v.toISOString() : String(v))),
  updatedAt: z.any().transform((v: unknown) => (v instanceof Date ? v.toISOString() : String(v))),
});

export class UserResponseDto extends (createZodDto(userResponseSchema) as ReturnType<
  typeof createZodDto<typeof userResponseSchema>
>) {}
