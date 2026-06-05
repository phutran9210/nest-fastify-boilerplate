import { HttpStatus } from '@nestjs/common';
import { AppException } from '@common/exceptions/app.exception';

describe('AppException', () => {
  it('carries messageKey as the HttpException message and the given status', () => {
    const ex = new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id: '1' });
    expect(ex.getStatus()).toBe(404);
    expect(ex.messageKey).toBe('users.NOT_FOUND');
    expect(ex.message).toBe('users.NOT_FOUND');
    expect(ex.args).toEqual({ id: '1' });
    expect(ex.code).toBeUndefined();
  });

  it('accepts an optional machine code override', () => {
    const ex = new AppException('auth.EMAIL_TAKEN', HttpStatus.CONFLICT, undefined, 'EMAIL_TAKEN');
    expect(ex.getStatus()).toBe(409);
    expect(ex.code).toBe('EMAIL_TAKEN');
  });
});
