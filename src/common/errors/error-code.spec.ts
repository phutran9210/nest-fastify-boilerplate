import { ErrorCode, statusToErrorCode } from './error-code';

describe('statusToErrorCode', () => {
  it.each([
    [400, ErrorCode.BAD_REQUEST],
    [401, ErrorCode.UNAUTHORIZED],
    [403, ErrorCode.FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [409, ErrorCode.CONFLICT],
    [422, ErrorCode.VALIDATION_ERROR],
    [429, ErrorCode.TOO_MANY_REQUESTS],
    [500, ErrorCode.INTERNAL_ERROR],
  ])('maps %i to %s', (status, code) => {
    expect(statusToErrorCode(status)).toBe(code);
  });

  it('falls back to HTTP_<status> for unmapped statuses', () => {
    expect(statusToErrorCode(418)).toBe('HTTP_418');
  });
});
