import { createZodDto } from 'nestjs-zod';
import { paginatedSchema } from '../../../common/http/paginated.schema';
import { userResponseSchema } from './user-response.dto';

export const paginatedUsersResponseSchema = paginatedSchema(userResponseSchema);

export class PaginatedUsersResponseDto extends (createZodDto(
  paginatedUsersResponseSchema,
) as ReturnType<typeof createZodDto<typeof paginatedUsersResponseSchema>>) {}
