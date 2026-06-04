import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

export class RegisterDto extends (createZodDto(registerSchema) as ReturnType<
  typeof createZodDto<typeof registerSchema>
>) {}
