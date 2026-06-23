import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { PrismaService } from '@core/prisma/prisma.service';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import type { ConfigService } from '@nestjs/config';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';
import { type AuthEnv, buildAuthOptions, type SocialCredential } from './auth-options';

export const AUTH_INSTANCE = Symbol('AUTH_INSTANCE');

export interface CreateAuthDeps {
  prisma: PrismaService;
  mail: MailProducer;
  outbox: OutboxRepository;
  config: ConfigService;
}

function readSocial(
  config: ConfigService,
  idKey: string,
  secretKey: string,
): SocialCredential | undefined {
  const clientId = config.get<string>(idKey);
  const clientSecret = config.get<string>(secretKey);
  return clientId && clientSecret ? { clientId, clientSecret } : undefined;
}

export function createAuth(deps: CreateAuthDeps) {
  const { prisma, mail, outbox, config } = deps;

  const env: AuthEnv = {
    secret: config.getOrThrow<string>('BETTER_AUTH_SECRET'),
    baseURL: config.getOrThrow<string>('BETTER_AUTH_URL'),
    trustedOrigins: config.get<string[]>('ALLOWED_ORIGINS') ?? [],
    adminUserIds: config.get<string[]>('ADMIN_USER_IDS') ?? [],
    requireEmailVerification: config.get<boolean>('EMAIL_VERIFICATION_REQUIRED') ?? true,
    google: readSocial(config, 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'),
    facebook: readSocial(config, 'FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'),
  };

  return betterAuth({
    ...buildAuthOptions(env),
    database: prismaAdapter(prisma, { provider: 'postgresql' }),
    emailVerification: {
      sendVerificationEmail: async ({ user, url }) => {
        await mail.enqueue({
          to: user.email,
          subject: 'Verify your email address',
          body: `Click the link to verify your email: ${url}`,
        });
      },
    },
    databaseHooks: {
      user: {
        create: {
          // Best-effort (non-transactional) — see spec §6. Worker outbox relay publishes it.
          after: async (user) => {
            await outbox.enqueue({
              routingKey: 'user.registered',
              payload: { userId: user.id, email: user.email, name: user.name ?? undefined },
            });
          },
        },
      },
    },
  });
}

export type AuthInstance = ReturnType<typeof createAuth>;
