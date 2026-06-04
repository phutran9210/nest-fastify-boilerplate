import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

export class CreateUserDto extends (createZodDto(createUserSchema) as ReturnType<
  typeof createZodDto<typeof createUserSchema>
>) {}
