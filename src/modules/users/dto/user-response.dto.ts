import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Dates use `z.any().transform(...)` (Date -> ISO string) on purpose: `z.date()` is not
// representable by Zod v4's `z.toJSONSchema()`, which nestjs-zod calls to build the Swagger
// doc — using `z.date()` here (even inside a union) crashes app bootstrap. Do not "simplify".
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
