import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { AuthUser } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';

// Runs after BetterAuthGuard (which populates req.user). Routes without @Roles pass through.
// A user passes when their role is in the required list OR their id is in ADMIN_USER_IDS.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') {
      return true;
    }

    const roles = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles || roles.length === 0) {
      return true;
    }

    const req = context.switchToHttp().getRequest();
    const user = req.user as AuthUser | undefined;
    if (!user) {
      throw new ForbiddenException();
    }

    const adminUserIds = this.config.get<string[]>('ADMIN_USER_IDS') ?? [];
    const roleMatches = user.role !== undefined && roles.includes(user.role);
    if (roleMatches || adminUserIds.includes(user.userId)) {
      return true;
    }
    throw new ForbiddenException();
  }
}
