import { toJSONSchema } from 'zod/v4/core';
import { paginatedUsersResponseSchema } from '../../modules/users/dto/paginated-users-response.dto';
import { errorResponseSchema } from './error-response.dto';

describe('OpenAPI JSON schema generation (nestjs-zod io=input)', () => {
  it.each([
    ['errorResponseSchema', errorResponseSchema],
    ['paginatedUsersResponseSchema', paginatedUsersResponseSchema],
  ])('%s is representable as JSON schema', (_name, schema) => {
    expect(() => toJSONSchema(schema as never, { io: 'input' })).not.toThrow();
  });
});
