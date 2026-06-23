# Better Auth Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the passport-jwt authentication with Better Auth (email+password, Google/Facebook social, email verification, bearer tokens) mounted natively on Fastify, with a global session guard.

**Architecture:** Better Auth's handler is mounted as a Fastify catch-all at `/api/auth/*` via the documented `auth.handler(Request)` Fetch bridge. A `BetterAuthModule` (core, `@Global`) builds the `auth` instance through a DI factory (Prisma + Mail + Outbox). A global `BetterAuthGuard` validates the session (cookie or bearer) on every other route and populates `req.user`, preserving `@Public()` and `@CurrentUser()`.

**Tech Stack:** NestJS 11, Fastify 5, Prisma 7 (ESM `prisma-client`, `@prisma/adapter-pg`), Better Auth (`better-auth`), nestjs-zod, Jest + @swc/jest, pnpm.

**Reference spec:** `docs/superpowers/specs/2026-06-23-better-auth-integration-design.md`

## Global Constraints

- Package manager: **pnpm only** (never npm/yarn).
- **No `any` in `src/`** — use explicit interfaces or `unknown` (Better Auth exports its own types; use `ReturnType<typeof betterAuth>`).
- Every HTTP route declares explicit `@HttpCode(HttpStatus.X)`; `status` in `ApiEnvelopeResponse` matches it.
- Controllers import Swagger only via `decorators/Api*()` — never from `@nestjs/swagger` directly.
- Imports outside the current module use path aliases (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`); within the same module use relative paths. Tests always use aliases.
- Tests live under `test/` mirroring `src/` — never colocated. Mock the repository PORT with `useValue`, not `PrismaService`. Call `jest.clearAllMocks()` in `beforeEach`.
- Date fields in response DTOs use `z.any().transform(v => v instanceof Date ? v.toISOString() : String(v))` — never `z.date()`.
- **Commits:** the user has a no-auto-commit rule. Run a task's commit step only with the user's go-ahead. Commit subjects MUST be lowercase conventional-commit (commitlint enforces `subject-case`), e.g. `feat(auth): ...`. The `commit-msg` hook also runs `tsc -p tsconfig.spec.json --noEmit` — typecheck must pass.
- After code changes run `pnpm check` (Biome format+lint --write) before committing.

---

## File Structure

**Created:**
- `src/core/auth/auth-options.ts` — pure builder of Better-Auth options shared by runtime + CLI (no DI, no DB).
- `src/core/auth/auth.ts` — `AUTH_INSTANCE` token, `AuthInstance` type, `createAuth(deps)` factory.
- `src/core/auth/auth.module.ts` — `@Global` `BetterAuthModule` wiring the factory.
- `src/core/auth/auth.cli.ts` — standalone `auth` export for `@better-auth/cli generate` (schema generation only).
- `src/common/guards/better-auth.guard.ts` — global session guard.
- `test/unit/common/guards/better-auth.guard.spec.ts`
- `test/e2e/auth.e2e-spec.ts`

**Modified:**
- `prisma/schema.prisma` — replace `User`, add `Session`/`Account`/`Verification`.
- `src/core/config/env.schema.ts` — add Better-Auth/social env; remove `JWT_*`.
- `src/main.ts` — mount handler + CORS credentials.
- `src/app.module.ts` — import `BetterAuthModule`; swap global guard.
- `src/modules/auth/auth.module.ts`, `controllers/auth.controller.ts`, `decorators/auth-api.decorator.ts` — strip register/login, keep `/me`.
- `src/modules/users/**` — read-only reduction.
- `test/unit/modules/users/services/users.service.spec.ts` — read-only tests.
- `package.json` — add `better-auth`; remove jwt/passport/bcrypt deps.

**Deleted:**
- `src/modules/auth/services/auth.service.ts`, `strategies/jwt.strategy.ts`, `auth.messages.ts`
- `src/modules/auth/dto/login.dto.ts`, `dto/login-response.dto.ts`, `dto/register.dto.ts`
- `src/common/guards/jwt-auth.guard.ts`
- `src/modules/users/dto/create-user.dto.ts`, `dto/update-user.dto.ts`

---

## Task 1: Dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Add Better Auth, remove passport/jwt/bcrypt**

```bash
pnpm add better-auth
pnpm remove @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt @types/passport-jwt @types/bcrypt
```

- [ ] **Step 2: Verify install**

Run: `pnpm ls better-auth`
Expected: prints a `better-auth` version (1.x). No error.

- [ ] **Step 3: Commit** (on user go-ahead)

```bash
git add package.json pnpm-lock.yaml
git commit -m "chore(auth): add better-auth, drop passport/jwt/bcrypt deps"
```

---

## Task 2: Environment schema

**Files:**
- Modify: `src/core/config/env.schema.ts`

**Interfaces:**
- Produces: env keys `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `ALLOWED_ORIGINS?`, `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `FACEBOOK_CLIENT_ID?`, `FACEBOOK_CLIENT_SECRET?`. Removes `JWT_SECRET`, `JWT_EXPIRES_IN`.

- [ ] **Step 1: Replace the JWT block with Better-Auth env**

In `src/core/config/env.schema.ts`, delete these two lines:

```ts
    JWT_SECRET: z.string().min(8),
    // Seconds until the access token expires (jsonwebtoken accepts a number of seconds).
    JWT_EXPIRES_IN: z.coerce.number().int().positive().default(3600),
```

Insert in their place:

```ts
    // ── Better Auth ───────────────────────────────────────────────────────
    // Server secret for signing sessions/tokens. Min 32 chars.
    BETTER_AUTH_SECRET: z.string().min(32),
    // Public base URL where the API (and /api/auth) is reachable.
    BETTER_AUTH_URL: z.url().default('http://localhost:3000'),
    // CSV of trusted origins (CORS + Better Auth CSRF). Empty → dev allows all.
    ALLOWED_ORIGINS: z
      .string()
      .optional()
      .transform((s) => (s ? s.split(',').map((o) => o.trim()).filter(Boolean) : [])),
    // Social providers — each registered only if BOTH id+secret are present.
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    FACEBOOK_CLIENT_ID: z.string().optional(),
    FACEBOOK_CLIENT_SECRET: z.string().optional(),
```

- [ ] **Step 2: Add the half-configured-provider guard inside `superRefine`**

In the existing `.superRefine((env, ctx) => { ... })`, append:

```ts
    // A social provider needs BOTH id and secret, or neither.
    const pairs: Array<[string, string, string]> = [
      ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'Google'],
      ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET', 'Facebook'],
    ];
    for (const [idKey, secretKey, label] of pairs) {
      const id = env[idKey as keyof typeof env];
      const secret = env[secretKey as keyof typeof env];
      if (Boolean(id) !== Boolean(secret)) {
        ctx.addIssue({
          code: 'custom',
          path: [id ? secretKey : idKey],
          message: `${label} OAuth needs both id and secret, or neither.`,
        });
      }
    }
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: no errors referencing `JWT_SECRET`/`JWT_EXPIRES_IN` from env (other JWT references are removed in Tasks 6/8; if typecheck still flags them there, that is expected until those tasks run — for this step, confirm `env.schema.ts` itself compiles).

- [ ] **Step 4: Commit** (on user go-ahead)

```bash
git add src/core/config/env.schema.ts
git commit -m "feat(config): add better-auth env, remove jwt env"
```

---

## Task 3: Better Auth options + CLI config

**Files:**
- Create: `src/core/auth/auth-options.ts`
- Create: `src/core/auth/auth.cli.ts`

**Interfaces:**
- Produces:
  - `buildAuthOptions(env: AuthEnv): BetterAuthOptions` where `AuthEnv = { secret: string; baseURL: string; trustedOrigins: string[]; google?: { clientId: string; clientSecret: string }; facebook?: { clientId: string; clientSecret: string } }`. Returns options containing `secret`, `baseURL`, `basePath: '/api/auth'`, `trustedOrigins`, `emailAndPassword`, `socialProviders`, `plugins: [bearer()]`. **Does not** set `database`, `databaseHooks`, or `emailVerification.sendVerificationEmail`.
  - `auth.cli.ts` exports `const auth` (a full `betterAuth(...)` with a Prisma adapter) for `@better-auth/cli generate` only.

- [ ] **Step 1: Write `auth-options.ts`**

```ts
import type { BetterAuthOptions } from 'better-auth';
import { bearer } from 'better-auth/plugins';

export interface SocialCredential {
  clientId: string;
  clientSecret: string;
}

export interface AuthEnv {
  secret: string;
  baseURL: string;
  trustedOrigins: string[];
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
      requireEmailVerification: true,
    },
    socialProviders,
    plugins: [bearer()],
  };
}
```

- [ ] **Step 2: Write `auth.cli.ts`** (schema generation only)

```ts
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
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (these files compile; they are not yet imported anywhere else).

- [ ] **Step 4: Commit** (on user go-ahead)

```bash
git add src/core/auth/auth-options.ts src/core/auth/auth.cli.ts
git commit -m "feat(auth): add better-auth options builder and cli config"
```

---

## Task 4: Prisma schema + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: Prisma models `User` (with `name`, `emailVerified`, `image`, relations), `Session`, `Account`, `Verification`. The regenerated client at `src/generated/prisma` exposes `prisma.user/session/account/verification`.

- [ ] **Step 1: Replace the `User` model**

In `prisma/schema.prisma`, replace the existing `User` block (lines 10-17) with these four models. (These match Better Auth's standard schema; Better Auth resolves models via the camelCase Prisma delegate, e.g. `prisma.user`, so no `@@map` is required.)

```prisma
model User {
  id            String    @id @default(uuid())
  name          String
  email         String    @unique
  emailVerified Boolean   @default(false)
  image         String?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt
  sessions      Session[]
  accounts      Account[]
}

model Session {
  id        String   @id @default(uuid())
  expiresAt DateTime
  token     String   @unique
  ipAddress String?
  userAgent String?
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}

model Account {
  id                    String    @id @default(uuid())
  accountId             String
  providerId            String
  userId                String
  user                  User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  accessToken           String?
  refreshToken          String?
  idToken               String?
  accessTokenExpiresAt  DateTime?
  refreshTokenExpiresAt DateTime?
  scope                 String?
  password              String?
  createdAt             DateTime  @default(now())
  updatedAt             DateTime  @updatedAt
}

model Verification {
  id         String   @id @default(uuid())
  identifier String
  value      String
  expiresAt  DateTime
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

Leave the `OutboxEvent` model unchanged.

- [ ] **Step 2: Cross-check against the Better Auth CLI (source of truth)**

Run: `npx @better-auth/cli@latest generate --config src/core/auth/auth.cli.ts --yes`
Expected: the CLI reports the schema is up to date, OR prints additions. If it proposes differences (extra columns/indexes for the chosen Better Auth version), apply them to `prisma/schema.prisma` and re-run until it reports no changes.
> If the CLI cannot load `auth.cli.ts` in this environment (TS/alias resolution), the hand-written models above are the known-good baseline — proceed with them.

- [ ] **Step 3: Generate client + migrate (DB reset)**

```bash
pnpm prisma:generate
pnpm prisma migrate reset --force
pnpm prisma:migrate --name better_auth_schema
```

Expected: migration applies; `src/generated/prisma` regenerated. `npx prisma studio` (optional) shows `User/Session/Account/Verification` tables.

- [ ] **Step 4: Commit** (on user go-ahead)

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): replace user model with better-auth schema"
```

---

## Task 5: Better Auth DI module

**Files:**
- Create: `src/core/auth/auth.ts`
- Create: `src/core/auth/auth.module.ts`

**Interfaces:**
- Consumes: `buildAuthOptions` (Task 3); `PrismaService` (`@core/prisma/prisma.service`); `MailProducer` (`@modules/mail/jobs/mail.producer`) via `MailProducerModule` (`@modules/mail/mail.producer.module`); `OutboxRepository` (`@core/outbox/outbox.repository.port`) via `OutboxModule.forProducer()`; `ConfigService`.
- Produces:
  - `AUTH_INSTANCE` (DI token, `Symbol`).
  - `type AuthInstance = ReturnType<typeof createAuth>`.
  - `createAuth(deps: { prisma: PrismaService; mail: MailProducer; outbox: OutboxRepository; config: ConfigService }): AuthInstance`.
  - `BetterAuthModule` (`@Global`) exporting `AUTH_INSTANCE`.

- [ ] **Step 1: Write `auth.ts`**

```ts
import { PrismaService } from '@core/prisma/prisma.service';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
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
```

- [ ] **Step 2: Write `auth.module.ts`**

```ts
import { OutboxModule } from '@core/outbox/outbox.module';
import { OutboxRepository } from '@core/outbox/outbox.repository.port';
import { PrismaService } from '@core/prisma/prisma.service';
import { MailProducer } from '@modules/mail/jobs/mail.producer';
import { MailProducerModule } from '@modules/mail/mail.producer.module';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AUTH_INSTANCE, createAuth } from './auth';

@Global()
@Module({
  imports: [MailProducerModule, OutboxModule.forProducer()],
  providers: [
    {
      provide: AUTH_INSTANCE,
      inject: [PrismaService, MailProducer, OutboxRepository, ConfigService],
      useFactory: (
        prisma: PrismaService,
        mail: MailProducer,
        outbox: OutboxRepository,
        config: ConfigService,
      ) => createAuth({ prisma, mail, outbox, config }),
    },
  ],
  exports: [AUTH_INSTANCE],
})
export class BetterAuthModule {}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (`prisma` is accepted by `prismaAdapter` because `PrismaService extends PrismaClient`.)

- [ ] **Step 4: Commit** (on user go-ahead)

```bash
git add src/core/auth/auth.ts src/core/auth/auth.module.ts
git commit -m "feat(auth): add better-auth di module"
```

---

## Task 6: Global guard

**Files:**
- Create: `src/common/guards/better-auth.guard.ts`
- Create: `test/unit/common/guards/better-auth.guard.spec.ts`
- Delete: `src/common/guards/jwt-auth.guard.ts`

**Interfaces:**
- Consumes: `AUTH_INSTANCE`, `AuthInstance` (Task 5); `IS_PUBLIC_KEY` (`@common/decorators/public.decorator`); `fromNodeHeaders` (`better-auth/node`).
- Produces: `BetterAuthGuard` (sets `req.user = { userId, email }` and `req.session`).

- [ ] **Step 1: Write the failing test**

`test/unit/common/guards/better-auth.guard.spec.ts`:

```ts
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

  it('populates req.user on a valid session', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const session = { user: { id: 'u1', email: 'a@b.c' }, session: { id: 's1' } };
    auth.api.getSession.mockResolvedValue(session);
    const ctx = ctxMock({ headers: { authorization: 'Bearer t' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.__req.user).toEqual({ userId: 'u1', email: 'a@b.c' });
    expect(ctx.__req.session).toBe(session);
  });

  void IS_PUBLIC_KEY;
  void AUTH_INSTANCE;
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test better-auth.guard`
Expected: FAIL — cannot find module `@common/guards/better-auth.guard`.

- [ ] **Step 3: Write the guard**

`src/common/guards/better-auth.guard.ts`:

```ts
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
    req.user = { userId: session.user.id, email: session.user.email };
    req.session = session;
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test better-auth.guard`
Expected: PASS (4 tests).

- [ ] **Step 5: Delete the old guard**

```bash
git rm src/common/guards/jwt-auth.guard.ts
```

- [ ] **Step 6: Commit** (on user go-ahead)

```bash
pnpm check
git add src/common/guards/better-auth.guard.ts test/unit/common/guards/better-auth.guard.spec.ts
git commit -m "feat(auth): add better-auth global guard, drop jwt guard"
```

---

## Task 7: Mount handler + app wiring

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `BetterAuthModule`, `AUTH_INSTANCE` (Task 5); `BetterAuthGuard` (Task 6); `fromNodeHeaders` (`better-auth/node`).

- [ ] **Step 1: Wire the module + global guard in `app.module.ts`**

Replace the import line:

```ts
import { JwtAuthGuard } from '@common/guards/jwt-auth.guard';
```

with:

```ts
import { BetterAuthGuard } from '@common/guards/better-auth.guard';
import { BetterAuthModule } from '@core/auth/auth.module';
```

Add `BetterAuthModule` to `imports` (after `RedisModule`). Replace the guard provider:

```ts
    { provide: APP_GUARD, useClass: JwtAuthGuard },
```

with:

```ts
    { provide: APP_GUARD, useClass: BetterAuthGuard },
```

- [ ] **Step 2: Mount the Better Auth handler in `main.ts`**

Add imports at the top of `src/main.ts`:

```ts
import { AUTH_INSTANCE, type AuthInstance } from './core/auth/auth';
import { fromNodeHeaders } from 'better-auth/node';
```

Replace `app.enableCors();` with:

```ts
  const allowedOrigins = config.get<string[]>('ALLOWED_ORIGINS') ?? [];
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  });

  // Mount Better Auth on a Fastify catch-all using the documented Fetch bridge.
  // Forward response headers verbatim so Set-Cookie AND set-auth-token reach the client.
  const auth: AuthInstance = app.get(AUTH_INSTANCE);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
```

- [ ] **Step 3: Boot the app and verify the auth route responds**

Ensure `.env` has `BETTER_AUTH_SECRET` (≥32 chars) and `BETTER_AUTH_URL`. Start: `pnpm start:dev` (in background or a second terminal).
Run: `curl -i -X POST http://localhost:3000/api/auth/sign-up/email -H 'content-type: application/json' -d '{"email":"a@b.co","password":"password123","name":"A"}'`
Expected: HTTP 200 with a JSON body containing a user; a `set-auth-token` response header is present. (A protected route like `GET /users` without credentials returns 401.)

- [ ] **Step 4: Commit** (on user go-ahead)

```bash
pnpm check
git add src/app.module.ts src/main.ts
git commit -m "feat(auth): mount better-auth handler and global guard"
```

---

## Task 8: Strip the Nest AuthModule to `/me`

**Files:**
- Modify: `src/modules/auth/auth.module.ts`
- Modify: `src/modules/auth/controllers/auth.controller.ts`
- Modify: `src/modules/auth/decorators/auth-api.decorator.ts`
- Delete: `src/modules/auth/services/auth.service.ts`, `strategies/jwt.strategy.ts`, `auth.messages.ts`, `dto/login.dto.ts`, `dto/login-response.dto.ts`, `dto/register.dto.ts`

**Interfaces:**
- Consumes: `BetterAuthGuard` (global), `@CurrentUser()`, `AuthUserResponseDto`.

- [ ] **Step 1: Reduce the controller to `/me` only**

Replace `src/modules/auth/controllers/auth.controller.ts` with:

```ts
import { type AuthUser, CurrentUser } from '@common/decorators/current-user.decorator';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiAuthController, ApiMe } from '../decorators/auth-api.decorator';

@ApiAuthController()
@Controller('auth')
export class AuthController {
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiMe()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
```

- [ ] **Step 2: Trim the Swagger decorator file**

In `src/modules/auth/decorators/auth-api.decorator.ts`, delete `ApiRegister`, `ApiLogin`, and the now-unused imports `UserResponseDto` and `LoginResponseDto`. Keep `ApiAuthController` and `ApiMe`. Result:

```ts
import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUserResponseDto } from '../dto/auth-user-response.dto';

export function ApiAuthController() {
  return applyDecorators(ApiTags('auth'), ApiStandardErrorResponses());
}

// GET /auth/me — requires a session (cookie or bearer) → 200 OK, current user in envelope.
export function ApiMe() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiEnvelopeResponse(AuthUserResponseDto, { status: HttpStatus.OK }),
  );
}
```

- [ ] **Step 3: Reduce the module**

Replace `src/modules/auth/auth.module.ts` with:

```ts
import { Module } from '@nestjs/common';
import { AuthController } from './controllers/auth.controller';

@Module({
  controllers: [AuthController],
})
export class AuthModule {}
```

- [ ] **Step 4: Delete the obsolete files**

```bash
git rm src/modules/auth/services/auth.service.ts \
       src/modules/auth/strategies/jwt.strategy.ts \
       src/modules/auth/auth.messages.ts \
       src/modules/auth/dto/login.dto.ts \
       src/modules/auth/dto/login-response.dto.ts \
       src/modules/auth/dto/register.dto.ts
```

Also delete the obsolete unit test if present:

```bash
git rm -f test/unit/modules/auth/services/auth.service.spec.ts 2>/dev/null || true
```

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: PASS. (No remaining references to the deleted files; `UsersModule` import removed from auth module.)

- [ ] **Step 6: Commit** (on user go-ahead)

```bash
pnpm check
git add -A src/modules/auth test/unit/modules/auth
git commit -m "refactor(auth): reduce nest auth module to /me endpoint"
```

---

## Task 9: Users module read-only

**Files:**
- Modify: `src/modules/users/controllers/users.controller.ts`
- Modify: `src/modules/users/decorators/users-api.decorator.ts`
- Modify: `src/modules/users/services/users.service.ts`
- Modify: `src/modules/users/repositories/user.repository.port.ts`
- Modify: `src/modules/users/repositories/user.repository.prisma.ts`
- Modify: `test/unit/modules/users/services/users.service.spec.ts`
- Delete: `src/modules/users/dto/create-user.dto.ts`, `dto/update-user.dto.ts`

**Interfaces:**
- Produces: `UserRepository` with `findById`, `findAll`, `count` only. `UsersService` with `findAll`, `findOne` only. Controller exposes `GET /users`, `GET /users/:id`.

- [ ] **Step 1: Rewrite the users service unit test (read-only)**

Replace `test/unit/modules/users/services/users.service.spec.ts` with:

```ts
import { UserRepository } from '@modules/users/repositories/user.repository.port';
import { UsersService } from '@modules/users/services/users.service';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

describe('UsersService', () => {
  let service: UsersService;
  let repo: jest.Mocked<Pick<UserRepository, 'findById' | 'findAll' | 'count'>>;

  beforeEach(async () => {
    jest.clearAllMocks();
    repo = { findById: jest.fn(), findAll: jest.fn(), count: jest.fn() };
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: UserRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findAll returns items + total with pagination', async () => {
    const items = [{ id: 'u1' }] as never;
    repo.findAll.mockResolvedValue(items);
    repo.count.mockResolvedValue(1);
    await expect(service.findAll({ page: 2, limit: 10 })).resolves.toEqual({ items, total: 1 });
    expect(repo.findAll).toHaveBeenCalledWith({ skip: 10, take: 10 });
  });

  it('findOne returns the user when found', async () => {
    const user = { id: 'u1' } as never;
    repo.findById.mockResolvedValue(user);
    await expect(service.findOne('u1')).resolves.toBe(user);
  });

  it('findOne throws NotFound when missing', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm test users.service`
Expected: FAIL — `service.findAll`/`findOne` may still pass, but the suite fails to compile if `AppException` vs `NotFoundException` differs. (See Step 3 — `findOne` currently throws `AppException`; adjust the test if the project maps it to a Nest exception. If `findOne` throws `AppException`, change the assertion to `.rejects.toThrow()`.) The intent: only read methods remain.

> Note: `UsersService.findOne` currently throws `AppException(UserMessage.NOT_FOUND, HttpStatus.NOT_FOUND)`. Keep that. Change the test's last assertion to `.rejects.toThrow()` to stay implementation-agnostic if `AppException` is not a `NotFoundException`.

- [ ] **Step 3: Trim `UsersService`**

In `src/modules/users/services/users.service.ts`, delete the `create`, `update`, and `remove` methods and remove now-unused imports (`CreateUserData`, `UpdateUserData`). Keep `findAll`, `findOne` (and the `UserRepository` injection). Resulting class body:

```ts
@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}

  async findAll(params: {
    page: number;
    limit: number;
  }): Promise<{ items: User[]; total: number }> {
    const { page, limit } = params;
    const [items, total] = await Promise.all([
      this.users.findAll({ skip: (page - 1) * limit, take: limit }),
      this.users.count(),
    ]);
    return { items, total };
  }

  async findOne(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new AppException(UserMessage.NOT_FOUND, HttpStatus.NOT_FOUND, { id });
    }
    return user;
  }
}
```

Adjust imports to drop `CreateUserData`/`UpdateUserData` (keep `User`, `UserRepository`, `AppException`, `UserMessage`, `HttpStatus`, `Injectable`).

- [ ] **Step 4: Trim the repository PORT**

In `src/modules/users/repositories/user.repository.port.ts`, remove `findByEmail`, `create`, `update`, `delete`, and the `CreateUserData`/`UpdateUserData` types. Keep:

```ts
import type { User } from '@generated/prisma/client';

export type { User };

export type FindUsersParams = { skip?: number; take?: number };

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findAll(params?: FindUsersParams): Promise<User[]>;
  abstract count(): Promise<number>;
}
```

- [ ] **Step 5: Trim the Prisma impl**

In `src/modules/users/repositories/user.repository.prisma.ts`, remove `findByEmail`, `create`, `update`, `delete`, and `mapError`; drop the now-unused imports (`Prisma`, `BadRequestException`, `ConflictException`, `NotFoundException`, `CreateUserData`, `UpdateUserData`). Keep:

```ts
import { PrismaService } from '@core/prisma/prisma.service';
import type { User } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type FindUsersParams, UserRepository } from './user.repository.port';

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.db.user.findUnique({ where: { id } });
  }

  findAll(params?: FindUsersParams): Promise<User[]> {
    return this.prisma.db.user.findMany({ skip: params?.skip, take: params?.take });
  }

  count(): Promise<number> {
    return this.prisma.db.user.count();
  }
}
```

- [ ] **Step 6: Reduce the controller**

In `src/modules/users/controllers/users.controller.ts`, delete the `create`, `update`, and `remove` methods and their decorator imports (`ApiCreateUser`, `ApiUpdateUser`, `ApiRemoveUser`), plus `Body`, `Delete`, `Patch`, `Post` from `@nestjs/common` and the `CreateUserDto`/`UpdateUserDto` imports. Keep `findAll` and `findOne`:

```ts
import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  ApiFindUser,
  ApiListUsers,
  ApiUsersController,
} from '../decorators/users-api.decorator';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../services/users.service';

@ApiUsersController()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(PaginatedUsersResponseDto)
  @ApiListUsers()
  async findAll(@Query() query: ListUsersQueryDto) {
    const { items, total } = await this.users.findAll(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(UserResponseDto)
  @ApiFindUser()
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }
}
```

- [ ] **Step 7: Trim the users Swagger decorator file**

In `src/modules/users/decorators/users-api.decorator.ts`, delete `ApiCreateUser`, `ApiUpdateUser`, `ApiRemoveUser` and any imports they alone used (e.g. `CreateUserDto`, `UpdateUserDto`). Keep `ApiUsersController`, `ApiListUsers`, `ApiFindUser`.

- [ ] **Step 8: Delete the write DTOs**

```bash
git rm src/modules/users/dto/create-user.dto.ts src/modules/users/dto/update-user.dto.ts
```

- [ ] **Step 9: Run tests + typecheck**

Run: `pnpm test users.service && pnpm typecheck`
Expected: PASS. No references to removed methods/DTOs remain.

- [ ] **Step 10: Commit** (on user go-ahead)

```bash
pnpm check
git add -A src/modules/users test/unit/modules/users
git commit -m "refactor(users): reduce to read-only endpoints"
```

---

## Task 10: End-to-end auth flows

**Files:**
- Create: `test/e2e/auth.e2e-spec.ts`

**Interfaces:**
- Consumes: `AppModule`, the mounted `/api/auth/*` route, `PrismaService` (to verify email in-test), `BetterAuthGuard`.

**Prereqs:** Postgres, Redis, and RabbitMQ reachable (same infra `pnpm test:e2e` already assumes). `.env` has `BETTER_AUTH_SECRET` (≥32) and `BETTER_AUTH_URL=http://localhost:3000`.

- [ ] **Step 1: Write the e2e spec**

`test/e2e/auth.e2e-spec.ts`:

```ts
import { PrismaService } from '@core/prisma/prisma.service';
import { fromNodeHeaders } from 'better-auth/node';
import { AppModule } from '@/app.module';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AUTH_INSTANCE, type AuthInstance } from '@core/auth/auth';
import { Test } from '@nestjs/testing';

// NOTE: replicate the /api/auth mount from main.ts so the handler exists under test.
async function buildApp(): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
  const auth: AuthInstance = app.get(AUTH_INSTANCE);
  const fastify = app.getHttpAdapter().getInstance();
  fastify.route({
    method: ['GET', 'POST'],
    url: '/api/auth/*',
    async handler(request, reply) {
      const url = new URL(request.url, `http://${request.headers.host}`);
      const req = new Request(url.toString(), {
        method: request.method,
        headers: fromNodeHeaders(request.headers),
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      const response = await auth.handler(req);
      reply.status(response.status);
      response.headers.forEach((value, key) => reply.header(key, value));
      return reply.send(response.body ? await response.text() : null);
    },
  });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const email = `e2e-${Date.now()}@example.com`;
  const password = 'password1234';

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.db.user.deleteMany({ where: { email } });
    await app.close();
  });

  it('rejects a protected route without credentials', async () => {
    const res = await app.inject({ method: 'GET', url: '/users' });
    expect(res.statusCode).toBe(401);
  });

  it('signs up, verifies, signs in (cookie) and reaches /auth/me', async () => {
    const signup = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email, password, name: 'E2E' },
    });
    expect(signup.statusCode).toBe(200);

    // requireEmailVerification blocks sign-in until verified — flip it directly in the DB.
    await prisma.db.user.update({ where: { email }, data: { emailVerified: true } });

    const signin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    });
    expect(signin.statusCode).toBe(200);

    const cookie = signin.headers['set-cookie'];
    expect(cookie).toBeDefined();
    const cookieHeader = Array.isArray(cookie) ? cookie.join('; ') : (cookie as string);

    const me = await app.inject({ method: 'GET', url: '/auth/me', headers: { cookie: cookieHeader } });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.email).toBe(email);
  });

  it('authenticates with a bearer token independently of cookies', async () => {
    const signin = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    });
    const token = signin.headers['set-auth-token'] as string;
    expect(token).toBeTruthy();

    const me = await app.inject({
      method: 'GET',
      url: '/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().data.email).toBe(email);
  });
});
```

> The `@/app.module` alias maps to `src/app.module` — if `@/*` is not configured in `jest.e2e.config.js`, import via a relative path `../../src/app.module` instead. The response envelope wraps payloads in `data` (per `ResponseInterceptor`); adjust `me.json().data` if the envelope shape differs.

- [ ] **Step 2: Run the e2e**

Run: `pnpm test:e2e auth`
Expected: PASS (3 tests). If `set-auth-token` is absent, confirm the `bearer()` plugin is in `buildAuthOptions` (Task 3) and that response headers are forwarded verbatim (Task 7).

- [ ] **Step 3: Full suite + lint**

Run: `pnpm test && pnpm lint && pnpm typecheck`
Expected: all PASS.

- [ ] **Step 4: Commit** (on user go-ahead)

```bash
pnpm check
git add test/e2e/auth.e2e-spec.ts
git commit -m "test(auth): e2e cookie and bearer auth flows"
```

---

## Final verification

- [ ] `pnpm typecheck` — PASS
- [ ] `pnpm test` — PASS
- [ ] `pnpm test:e2e` — PASS
- [ ] `pnpm lint` — clean
- [ ] Manual: `pnpm start:dev`, sign up via `/api/auth/sign-up/email`, verify a `mail` job appears in Bull Board (`pnpm start:worker:dev`, `/admin/queues`), confirm `user.registered` is published by the worker outbox relay.
- [ ] Update `CLAUDE.md` Auth row (passport-jwt → Better Auth) and README note that `/api/auth/*` lives outside Nest Swagger.
