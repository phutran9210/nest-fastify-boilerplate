import { toJSONSchema } from 'zod/v4/core';
import { authUserResponseSchema } from '../../modules/auth/dto/auth-user-response.dto';
import { loginResponseSchema } from '../../modules/auth/dto/login-response.dto';
import { paginatedUsersResponseSchema } from '../../modules/users/dto/paginated-users-response.dto';
import { userResponseSchema } from '../../modules/users/dto/user-response.dto';
import { errorResponseSchema } from './error-response.dto';

describe('OpenAPI JSON schema generation (nestjs-zod io=input)', () => {
  it.each([
    ['errorResponseSchema', errorResponseSchema],
    ['paginatedUsersResponseSchema', paginatedUsersResponseSchema],
    ['userResponseSchema', userResponseSchema],
    ['loginResponseSchema', loginResponseSchema],
    ['authUserResponseSchema', authUserResponseSchema],
  ])('%s is representable as JSON schema', (_name, schema) => {
    expect(() => toJSONSchema(schema as never, { io: 'input' })).not.toThrow();
  });
});
