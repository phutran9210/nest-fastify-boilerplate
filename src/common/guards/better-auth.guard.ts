import { AUTH_INSTANCE, type AuthInstance } from '@core/auth/auth';
import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { fromNodeHeaders } from 'better-auth/node';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class BetterAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(AUTH_INSTANCE) private readonly auth: AuthInstance,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // Non-HTTP (RabbitMQ/BullMQ) handlers carry no Authorization header — never guard them.
    if (context.getType() !== 'http') {
      return true;
    }

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
    if (!session) {
      throw new UnauthorizedException();
    }
    /* Admin plugin adds `role` at runtime but TS cannot infer it through
       the `buildAuthOptions` spread — extract it safely via `in` guard. */
    const sessionUser: Record<string, unknown> = session.user;
    req.user = {
      userId: session.user.id,
      email: session.user.email,
      role: typeof sessionUser.role === 'string' ? sessionUser.role : undefined,
    };
    req.session = session;
    return true;
  }
}
