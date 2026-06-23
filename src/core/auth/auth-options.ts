import type { BetterAuthOptions } from 'better-auth';
import { admin, bearer } from 'better-auth/plugins';

export interface SocialCredential {
  clientId: string;
  clientSecret: string;
}

export interface AuthEnv {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
  adminUserIds: string[];
  // Require email verification before sign-in. Off in dev for convenience; keep ON in prod.
  requireEmailVerification: boolean;
  google?: SocialCredential;
  facebook?: SocialCredential;
}

// Shared between the runtime DI factory (auth.ts) and the CLI schema generator (auth.cli.ts).
// Contains everything that affects the generated DB schema EXCEPT the database adapter,
// runtime hooks, and the verification-email sender (those are runtime-only, added in auth.ts).
export function buildAuthOptions(env: AuthEnv): BetterAuthOptions {
  const socialProviders: NonNullable<BetterAuthOptions['socialProviders']> = {};
  if (env.google) socialProviders.google = env.google;
  if (env.facebook) socialProviders.facebook = env.facebook;

  return {
    secret: env.secret,
    baseURL: env.baseURL,
    basePath: '/api/auth',
    trustedOrigins: env.trustedOrigins,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: env.requireEmailVerification,
    },
    socialProviders,
    plugins: [
      bearer(),
      admin({ defaultRole: 'user', adminRoles: ['admin'], adminUserIds: env.adminUserIds }),
    ],
  };
}
