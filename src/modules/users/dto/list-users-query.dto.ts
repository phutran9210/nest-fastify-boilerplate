import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ListUsersQueryDto extends (createZodDto(listUsersQuerySchema) as ReturnType<
  typeof createZodDto<typeof listUsersQuerySchema>
>) {}
