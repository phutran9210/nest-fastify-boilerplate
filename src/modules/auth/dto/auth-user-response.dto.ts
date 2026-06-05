import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// AuthUser shape: { userId: string; email: string } — from current-user.decorator.ts
export const authUserResponseSchema = z.object({
  userId: z.string(),
  email: z.email(),
});

export class AuthUserResponseDto extends (createZodDto(authUserResponseSchema) as ReturnType<
  typeof createZodDto<typeof authUserResponseSchema>
>) {}
