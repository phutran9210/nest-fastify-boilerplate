// Standalone Better Auth instance used ONLY by `@better-auth/cli generate` to derive the
// Prisma schema. NOT imported at runtime (the runtime instance is built via DI in auth.ts).
// Uses a throwaway PrismaClient — schema generation needs the adapter's provider, not a live tx.
import { PrismaPg } from '@prisma/adapter-pg';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { PrismaClient } from '../../generated/prisma/client';
import { buildAuthOptions } from './auth-options';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? '' }),
});

export const auth = betterAuth({
  ...buildAuthOptions({
    secret: process.env.BETTER_AUTH_SECRET ?? 'cli-only-secret-cli-only-secret-32',
    baseURL: process.env.BETTER_AUTH_URL ?? 'http://localhost:3000',
    trustedOrigins: [],
    adminUserIds: [],
    requireEmailVerification: true,
    google:
      process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET
        ? { clientId: process.env.GOOGLE_CLIENT_ID, clientSecret: process.env.GOOGLE_CLIENT_SECRET }
        : undefined,
    facebook:
      process.env.FACEBOOK_CLIENT_ID && process.env.FACEBOOK_CLIENT_SECRET
        ? {
            clientId: process.env.FACEBOOK_CLIENT_ID,
            clientSecret: process.env.FACEBOOK_CLIENT_SECRET,
          }
        : undefined,
  }),
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
});
