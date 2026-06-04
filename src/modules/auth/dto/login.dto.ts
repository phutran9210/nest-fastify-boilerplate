import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export class LoginDto extends (createZodDto(loginSchema) as ReturnType<
  typeof createZodDto<typeof loginSchema>
>) {}
