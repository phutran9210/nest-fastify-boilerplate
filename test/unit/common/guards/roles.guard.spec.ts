import { RolesGuard } from '@common/guards/roles.guard';
import { ROLES_KEY } from '@common/decorators/roles.decorator';
import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

function ctxMock(opts: { type?: string; user?: any } = {}): any {
  const req: any = { user: opts.user };
  return {
    getType: () => opts.type ?? 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
  };
}

function makeGuard(reflector: Reflector, adminUserIds: string[]): RolesGuard {
  const config = { get: jest.fn().mockReturnValue(adminUserIds) } as any;
  return new RolesGuard(reflector, config);
}

describe('RolesGuard', () => {
  let reflector: Reflector;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
  });

  it('allows non-http contexts', () => {
    const guard = makeGuard(reflector, []);
    expect(guard.canActivate(ctxMock({ type: 'rpc' }))).toBe(true);
  });

  it('allows routes without @Roles', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(undefined);
    const guard = makeGuard(reflector, []);
    expect(guard.canActivate(ctxMock({ user: { userId: 'u1', email: 'a@b.c' } }))).toBe(true);
  });

  it('allows when the user role matches', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const guard = makeGuard(reflector, []);
    expect(
      guard.canActivate(ctxMock({ user: { userId: 'u1', email: 'a@b.c', role: 'admin' } })),
    ).toBe(true);
  });

  it('allows when the user is in ADMIN_USER_IDS even if role mismatches', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const guard = makeGuard(reflector, ['u1']);
    expect(
      guard.canActivate(ctxMock({ user: { userId: 'u1', email: 'a@b.c', role: 'user' } })),
    ).toBe(true);
  });

  it('throws 403 on role mismatch and not in ADMIN_USER_IDS', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const guard = makeGuard(reflector, []);
    expect(() =>
      guard.canActivate(ctxMock({ user: { userId: 'u1', email: 'a@b.c', role: 'user' } })),
    ).toThrow(ForbiddenException);
  });

  it('throws 403 when there is no authenticated user', () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(['admin']);
    const guard = makeGuard(reflector, []);
    expect(() => guard.canActivate(ctxMock({ user: undefined }))).toThrow(ForbiddenException);
  });
});
