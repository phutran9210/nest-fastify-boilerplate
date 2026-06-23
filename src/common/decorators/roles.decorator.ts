import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Restrict a route to the given roles. Enforced by the global RolesGuard.
// A user in ADMIN_USER_IDS satisfies any @Roles requirement (see RolesGuard).
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
