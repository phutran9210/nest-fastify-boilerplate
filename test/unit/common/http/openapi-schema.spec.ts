import { healthResponseSchema } from '@core/health/dto/health-response.dto';
import { authUserResponseSchema } from '@modules/auth/dto/auth-user-response.dto';
import { loginResponseSchema } from '@modules/auth/dto/login-response.dto';
import { mailTestResponseSchema } from '@modules/mail/dto/mail-test-response.dto';
import { notificationPublishResponseSchema } from '@modules/notifications/dto/notification-publish-response.dto';
import { paginatedUsersResponseSchema } from '@modules/users/dto/paginated-users-response.dto';
import { userResponseSchema } from '@modules/users/dto/user-response.dto';
import { toJSONSchema } from 'zod/v4/core';
import { errorResponseSchema } from '@common/http/error-response.dto';

describe('OpenAPI JSON schema generation (nestjs-zod io=input)', () => {
  it.each([
    ['errorResponseSchema', errorResponseSchema],
    ['paginatedUsersResponseSchema', paginatedUsersResponseSchema],
    ['userResponseSchema', userResponseSchema],
    ['loginResponseSchema', loginResponseSchema],
    ['authUserResponseSchema', authUserResponseSchema],
    ['mailTestResponseSchema', mailTestResponseSchema],
    ['notificationPublishResponseSchema', notificationPublishResponseSchema],
    ['healthResponseSchema', healthResponseSchema],
  ])('%s is representable as JSON schema', (_name, schema) => {
    expect(() => toJSONSchema(schema as never, { io: 'input' })).not.toThrow();
  });
});
