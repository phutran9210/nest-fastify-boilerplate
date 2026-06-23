jest.mock('better-auth', () => ({ betterAuth: jest.fn() }));
jest.mock('better-auth/adapters/prisma', () => ({ prismaAdapter: jest.fn() }));
jest.mock('better-auth/plugins', () => ({ bearer: jest.fn() }));
jest.mock('better-auth/node', () => ({ fromNodeHeaders: jest.fn((h: any) => h) }));

import { AUTH_INSTANCE } from '@core/auth/auth';
import { BetterAuthGuard } from '@common/guards/better-auth.guard';
import { IS_PUBLIC_KEY } from '@common/decorators/public.decorator';
import { UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

function ctxMock(opts: { type?: string; headers?: Record<string, string> } = {}): any {
  const req: any = { headers: opts.headers ?? {} };
  return {
    getType: () => opts.type ?? 'http',
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => req }),
    __req: req,
  };
}

describe('BetterAuthGuard', () => {
  let reflector: Reflector;
  let auth: { api: { getSession: jest.Mock } };
  let guard: BetterAuthGuard;

  beforeEach(() => {
    jest.clearAllMocks();
    reflector = new Reflector();
    auth = { api: { getSession: jest.fn() } };
    guard = new BetterAuthGuard(reflector, auth as never);
  });

  it('allows non-http contexts without checking session', async () => {
    const ctx = ctxMock({ type: 'rpc' });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('allows @Public routes', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(true);
    const ctx = ctxMock();
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(auth.api.getSession).not.toHaveBeenCalled();
  });

  it('throws 401 when no session', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    auth.api.getSession.mockResolvedValue(null);
    await expect(guard.canActivate(ctxMock())).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('populates req.user (with role) on a valid session', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const session = { user: { id: 'u1', email: 'a@b.c', role: 'admin' }, session: { id: 's1' } };
    auth.api.getSession.mockResolvedValue(session);
    const ctx = ctxMock({ headers: { authorization: 'Bearer t' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.__req.user).toEqual({ userId: 'u1', email: 'a@b.c', role: 'admin' });
    expect(ctx.__req.session).toBe(session);
  });

  void IS_PUBLIC_KEY;
  void AUTH_INSTANCE;
});
