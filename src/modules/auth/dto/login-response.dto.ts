import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const loginResponseSchema = z.object({
  accessToken: z.string(),
});

export class LoginResponseDto extends (createZodDto(loginResponseSchema) as ReturnType<
  typeof createZodDto<typeof loginResponseSchema>
>) {}
