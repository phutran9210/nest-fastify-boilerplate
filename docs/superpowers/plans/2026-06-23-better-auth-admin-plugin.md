# Better Auth Admin Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the Better Auth `admin()` plugin (roles, user management, banning) plus a Nest `@Roles()` decorator and global `RolesGuard` for role-protecting Nest routes.

**Architecture:** Enable `admin()` in the shared `auth-options.ts` plugins — admin endpoints are served automatically under the already-mounted `/api/auth/*`. Seed admins via `adminUserIds` from env. The global `BetterAuthGuard` propagates `role` onto `req.user`; a second global `RolesGuard` enforces `@Roles()` (allowing role match OR membership in `ADMIN_USER_IDS`).

**Tech Stack:** NestJS 11, Fastify 5, Prisma 7 (ESM), `better-auth` 1.6.x (`better-auth/plugins` → `admin`), nestjs-zod, Jest + @swc/jest, pnpm.

**Reference spec:** `docs/superpowers/specs/2026-06-23-better-auth-admin-plugin-design.md`
**Builds on:** branch `feat/better-auth` (base Better Auth integration already implemented; admin fields/migration deferred-pending DB along with the base migration).

## Global Constraints

- Package manager: **pnpm only**.
- **No `any` in `src/`** (allowed in test files for mocks). Use Better Auth's own types.
- Imports outside the current module use path aliases (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`); within the same folder (e.g. inside `src/common/`) use relative paths. Tests always use aliases.
- Tests live under `test/` mirroring `src/`. `jest.clearAllMocks()` in `beforeEach`.
- Default roles only: `user` / `admin`. No custom access control.
- **Commits:** no-commit mode — the SDD controller reviews via working-tree diffs and the user commits at the end. Implementers must NOT run `git commit`/`git add`/`git push`; use plain `rm` for deletions. (If committing later: lowercase conventional-commit subjects; the `commit-msg` hook runs `tsc -p tsconfig.spec.json`.)
- After code changes run `pnpm exec biome check --write <files>` before reporting.

---

## File Structure

**Created:**
- `src/common/decorators/roles.decorator.ts` — `@Roles(...roles)` + `ROLES_KEY`.
- `src/common/guards/roles.guard.ts` — global `RolesGuard`.
- `test/unit/common/guards/roles.guard.spec.ts`.

**Modified:**
- `src/core/config/env.schema.ts` — add `ADMIN_USER_IDS` (CSV → `string[]`).
- `src/core/auth/auth-options.ts` — add `admin()` to plugins; `AuthEnv.adminUserIds`.
- `src/core/auth/auth.ts` — read `ADMIN_USER_IDS` into `AuthEnv`.
- `src/core/auth/auth.cli.ts` — pass `adminUserIds: []`.
- `prisma/schema.prisma` — admin fields on `User` + `impersonatedBy` on `Session` (via CLI generate).
- `src/common/decorators/current-user.decorator.ts` — `AuthUser.role?: string`.
- `src/common/guards/better-auth.guard.ts` — set `role` on `req.user`.
- `test/unit/common/guards/better-auth.guard.spec.ts` — assert `role`.
- `src/app.module.ts` — register `RolesGuard` as a second `APP_GUARD` after `BetterAuthGuard`.

---

## Task 1: Env — `ADMIN_USER_IDS`

**Files:**
- Modify: `src/core/config/env.schema.ts`

**Interfaces:**
- Produces: env key `ADMIN_USER_IDS` — optional CSV transformed to `string[]` (absent ⇒ `[]`), same shape as `ALLOWED_ORIGINS`.

- [ ] **Step 1: Add the var next to `ALLOWED_ORIGINS`**

In `src/core/config/env.schema.ts`, immediately AFTER the existing `ALLOWED_ORIGINS` block (the `z.string().optional().transform(...)` that ends with `: [],` and a closing `),`), add:

```ts
    // CSV of user ids always treated as admin (Better Auth `adminUserIds` + Nest RolesGuard).
    ADMIN_USER_IDS: z
      .string()
      .optional()
      .transform((s) =>
        s
          ? s
              .split(',')
              .map((id) => id.trim())
              .filter(Boolean)
          : [],
      ),
```

- [ ] **Step 2: Typecheck the file**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "env.schema" || echo "no env.schema errors"`
Expected: `no env.schema errors`.

- [ ] **Step 3: Verify the existing env test still passes**

Run: `pnpm test env.schema`
Expected: PASS (the new var is optional with a default, so existing fixtures are unaffected).

- [ ] **Step 4: Format**

Run: `pnpm exec biome check --write src/core/config/env.schema.ts`

---

## Task 2: Enable `admin()` plugin

**Files:**
- Modify: `src/core/auth/auth-options.ts`
- Modify: `src/core/auth/auth.ts`
- Modify: `src/core/auth/auth.cli.ts`

**Interfaces:**
- Consumes: `ADMIN_USER_IDS` env (Task 1).
- Produces: `AuthEnv.adminUserIds: string[]`; the built options now include `admin({ defaultRole: 'user', adminRoles: ['admin'], adminUserIds })`. The runtime `AuthInstance` type now exposes admin endpoints and `session.user.role`.

- [ ] **Step 1: `auth-options.ts` — add the field and the plugin**

In `src/core/auth/auth-options.ts`, change the `bearer` import to also import `admin`:

```ts
import { admin, bearer } from 'better-auth/plugins';
```

Add `adminUserIds` to `AuthEnv` (after `trustedOrigins`):

```ts
  trustedOrigins: string[];
  adminUserIds: string[];
```

Change the `plugins` line in the returned object to:

```ts
    plugins: [
      bearer(),
      admin({ defaultRole: 'user', adminRoles: ['admin'], adminUserIds: env.adminUserIds }),
    ],
```

- [ ] **Step 2: `auth.ts` — read the env**

In `src/core/auth/auth.ts`, inside `createAuth`, add `adminUserIds` to the `env` object (after the `trustedOrigins` line):

```ts
    trustedOrigins: config.get<string[]>('ALLOWED_ORIGINS') ?? [],
    adminUserIds: config.get<string[]>('ADMIN_USER_IDS') ?? [],
```

- [ ] **Step 3: `auth.cli.ts` — pass an empty list**

In `src/core/auth/auth.cli.ts`, inside the `buildAuthOptions({ ... })` call, add `adminUserIds: []` (after `trustedOrigins: [],`):

```ts
    trustedOrigins: [],
    adminUserIds: [],
```

- [ ] **Step 4: Typecheck**

Run: `pnpm exec tsc --noEmit -p tsconfig.json 2>&1 | grep -E "core/auth/" || echo "no errors in core/auth"`
Expected: `no errors in core/auth`. If `admin` is not exported from `better-auth/plugins` in the installed version, check the correct export path and adjust the import (note it). The `admin` options `defaultRole`/`adminRoles`/`adminUserIds` are the documented option names.

- [ ] **Step 5: Format + confirm unit suite still green**

Run: `pnpm exec biome check --write src/core/auth/auth-options.ts src/core/auth/auth.ts src/core/auth/auth.cli.ts && pnpm test 2>&1 | tail -5`
Expected: Biome clean; existing unit tests still pass (the guard test mocks `better-auth/plugins` — confirm it still loads; if the mock now needs `admin`, that is handled in Task 4's test update, but the current test should still pass since it does not import the real plugin).

---

## Task 3: Prisma schema (admin fields) + migration

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `User` gains `role`, `banned`, `banReason`, `banExpires`; `Session` gains `impersonatedBy`. Regenerated client exposes these fields.

- [ ] **Step 1: Generate the admin fields from the CLI (source of truth)**

Run: `npx @better-auth/cli@latest generate --config src/core/auth/auth.cli.ts --yes`
Expected: the CLI adds the admin columns to `prisma/schema.prisma`. Review the diff — `User` should gain `role` (e.g. `String? @default("user")`), `banned` (`Boolean? @default(false)`), `banReason String?`, `banExpires DateTime?`; `Session` should gain `impersonatedBy String?`.

> If the CLI cannot load `auth.cli.ts` in this environment, hand-add to `prisma/schema.prisma`:
> - In `model User { ... }` (before `@@map("user")`):
>   ```prisma
>   role          String?   @default("user")
>   banned        Boolean?  @default(false)
>   banReason     String?
>   banExpires    DateTime?
>   ```
> - In `model Session { ... }` (before `@@map("session")`):
>   ```prisma
>   impersonatedBy String?
>   ```

- [ ] **Step 2: Regenerate the client**

Run: `pnpm prisma:generate`
Expected: succeeds; `src/generated/prisma` now types the admin fields.

- [ ] **Step 3: Migrate (NEEDS Postgres reachable)**

Run: `pnpm prisma:migrate --name better_auth_admin`
Expected: migration applies. **If Postgres is unreachable** (the base integration's migration is also still pending), do NOT hang: report **DONE_WITH_CONCERNS** noting the migration is deferred and must be applied together with the base `better_auth_schema` migration when the DB is up. Step 2 (`prisma generate`) is the critical deliverable for downstream typechecks.

- [ ] **Step 4: Format check (schema)**

Run: `pnpm exec prisma format` then confirm `git diff --stat prisma/schema.prisma` shows only the intended additions.

---

## Task 4: Propagate `role` onto `req.user`

**Files:**
- Modify: `src/common/decorators/current-user.decorator.ts`
- Modify: `src/common/guards/better-auth.guard.ts`
- Modify: `test/unit/common/guards/better-auth.guard.spec.ts`

**Interfaces:**
- Consumes: admin plugin active (Task 2) so `session.user.role` is typed.
- Produces: `AuthUser = { userId: string; email: string; role?: string }`; `BetterAuthGuard` sets `req.user.role`.

- [ ] **Step 1: Update the failing test first**

In `test/unit/common/guards/better-auth.guard.spec.ts`, update the "populates req.user on a valid session" test to include and assert `role`:

```ts
  it('populates req.user (with role) on a valid session', async () => {
    jest.spyOn(reflector, 'getAllAndOverride').mockReturnValue(false);
    const session = { user: { id: 'u1', email: 'a@b.c', role: 'admin' }, session: { id: 's1' } };
    auth.api.getSession.mockResolvedValue(session);
    const ctx = ctxMock({ headers: { authorization: 'Bearer t' } });
    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(ctx.__req.user).toEqual({ userId: 'u1', email: 'a@b.c', role: 'admin' });
    expect(ctx.__req.session).toBe(session);
  });
```

- [ ] **Step 2: Run it — confirm it fails**

Run: `pnpm test better-auth.guard`
Expected: FAIL — `req.user` is `{ userId, email }` (no `role`), so `toEqual({...role:'admin'})` mismatches.

- [ ] **Step 3: Add `role` to `AuthUser`**

In `src/common/decorators/current-user.decorator.ts`, update the interface:

```ts
export interface AuthUser {
  userId: string;
  email: string;
  role?: string;
}
```

- [ ] **Step 4: Set `role` in the guard**

In `src/common/guards/better-auth.guard.ts`, change the `req.user` assignment:

```ts
    req.user = {
      userId: session.user.id,
      email: session.user.email,
      role: session.user.role ?? undefined,
    };
```

- [ ] **Step 5: Run — confirm pass**

Run: `pnpm test better-auth.guard`
Expected: PASS (4 tests). If `session.user.role` does not typecheck (admin plugin types not inferred), confirm Task 2 added `admin()` to the SAME options object that `AuthInstance` is derived from; the role field comes from the plugin's user type.

- [ ] **Step 6: Format**

Run: `pnpm exec biome check --write src/common/decorators/current-user.decorator.ts src/common/guards/better-auth.guard.ts test/unit/common/guards/better-auth.guard.spec.ts`

---

## Task 5: `@Roles()` + global `RolesGuard`

**Files:**
- Create: `src/common/decorators/roles.decorator.ts`
- Create: `src/common/guards/roles.guard.ts`
- Create: `test/unit/common/guards/roles.guard.spec.ts`
- Modify: `src/app.module.ts`

**Interfaces:**
- Consumes: `AuthUser` (Task 4, `{ userId, email, role? }`); `ADMIN_USER_IDS` env (Task 1).
- Produces: `ROLES_KEY` + `Roles(...roles)`; `RolesGuard`. Registered as a second global `APP_GUARD` after `BetterAuthGuard`.

- [ ] **Step 1: Write the decorator**

`src/common/decorators/roles.decorator.ts`:

```ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';

// Restrict a route to the given roles. Enforced by the global RolesGuard.
// A user in ADMIN_USER_IDS satisfies any @Roles requirement (see RolesGuard).
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

- [ ] **Step 2: Write the failing test**

`test/unit/common/guards/roles.guard.spec.ts`:

```ts
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
```

- [ ] **Step 3: Run — confirm it fails**

Run: `pnpm test roles.guard`
Expected: FAIL — cannot find module `@common/guards/roles.guard`.

- [ ] **Step 4: Write the guard**

`src/common/guards/roles.guard.ts`:

```ts
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
```

- [ ] **Step 5: Run — confirm pass**

Run: `pnpm test roles.guard`
Expected: PASS (6 tests).

- [ ] **Step 6: Register the guard globally (after BetterAuthGuard)**

In `src/app.module.ts`, add the import near the `BetterAuthGuard` import:

```ts
import { RolesGuard } from '@common/guards/roles.guard';
```

Then add a provider immediately AFTER the existing `{ provide: APP_GUARD, useClass: BetterAuthGuard },` line:

```ts
    { provide: APP_GUARD, useClass: BetterAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
```

(Order matters: Nest runs `APP_GUARD`s in registration order, so `BetterAuthGuard` populates `req.user` before `RolesGuard` reads it.)

- [ ] **Step 7: Typecheck + format + full unit suite**

Run: `pnpm typecheck && pnpm exec biome check --write src/common/decorators/roles.decorator.ts src/common/guards/roles.guard.ts src/app.module.ts test/unit/common/guards/roles.guard.spec.ts && pnpm test 2>&1 | tail -5`
Expected: typecheck clean; all unit tests pass.

---

## Task 6: Admin e2e (spec written; run deferred)

**Files:**
- Create: `test/e2e/admin.e2e-spec.ts`

**Interfaces:**
- Consumes: the `/api/auth/admin/*` endpoints (admin plugin), `ADMIN_USER_IDS`, the `buildApp()` mount pattern from `test/e2e/auth.e2e-spec.ts`.

**Prereqs:** Postgres up + the `better_auth_schema` AND `better_auth_admin` migrations applied; `BETTER_AUTH_SECRET` (≥32) and `ADMIN_USER_IDS` set in the test env.

- [ ] **Step 1: Write the e2e spec**

`test/e2e/admin.e2e-spec.ts`:

```ts
import { AUTH_INSTANCE, type AuthInstance } from '@core/auth/auth';
import { PrismaService } from '@core/prisma/prisma.service';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { fromNodeHeaders } from 'better-auth/node';
import { AppModule } from '../../src/app.module';

// Replicate the /api/auth mount from main.ts (same as auth.e2e-spec.ts).
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

describe('Admin (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const adminEmail = `admin-${Date.now()}@example.com`;
  const userEmail = `user-${Date.now()}@example.com`;
  const password = 'password1234';
  let adminId: string;

  beforeAll(async () => {
    app = await buildApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.db.user.deleteMany({ where: { email: { in: [adminEmail, userEmail] } } });
    await app.close();
  });

  async function signUpVerified(email: string): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      payload: { email, password, name: 'E2E' },
    });
    await prisma.db.user.update({ where: { email }, data: { emailVerified: true } });
    const u = await prisma.db.user.findUnique({ where: { email } });
    return u?.id as string;
  }

  async function bearerFor(email: string): Promise<string> {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      payload: { email, password },
    });
    return res.headers['set-auth-token'] as string;
  }

  it('promotes an admin (ADMIN_USER_IDS) and lists users; non-admin is rejected', async () => {
    adminId = await signUpVerified(adminEmail);
    await signUpVerified(userEmail);

    // NOTE: this test assumes the admin user's id is included in ADMIN_USER_IDS for the
    // test process. Set ADMIN_USER_IDS to include `adminId` before running, OR set
    // role='admin' directly: await prisma.db.user.update({ where:{ email:adminEmail }, data:{ role:'admin' }})
    await prisma.db.user.update({ where: { email: adminEmail }, data: { role: 'admin' } });

    const adminToken = await bearerFor(adminEmail);
    const userToken = await bearerFor(userEmail);

    const ok = await app.inject({
      method: 'GET',
      url: '/api/auth/admin/list-users?limit=10',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(ok.statusCode).toBe(200);
    expect(Array.isArray(ok.json().users)).toBe(true);

    const denied = await app.inject({
      method: 'GET',
      url: '/api/auth/admin/list-users?limit=10',
      headers: { authorization: `Bearer ${userToken}` },
    });
    expect(denied.statusCode).toBeGreaterThanOrEqual(401);
    expect(denied.statusCode).toBeLessThan(404);
  });
});
```

- [ ] **Step 2: Typecheck the spec**

Run: `pnpm exec tsc --noEmit -p tsconfig.spec.json 2>&1 | grep -E "admin.e2e-spec" || echo "no typecheck errors in admin.e2e-spec"`
Expected: `no typecheck errors in admin.e2e-spec`.

- [ ] **Step 3: Attempt the run (deferred if DB down)**

Run: `pnpm test:e2e admin 2>&1 | tail -30`
Expected: if Postgres + migrations are up and `adminId` has `role='admin'` (the spec sets it directly), the test passes. **If Postgres is down**, the module graph should still LOAD (the e2e jest ESM config from the base integration handles better-auth); the only failure should be the DB connection in `beforeAll`. Report which failure mode occurred — an ESM-load failure is a config defect to fix; a DB-connection failure is expected/deferred.

- [ ] **Step 4: Format**

Run: `pnpm exec biome check --write test/e2e/admin.e2e-spec.ts`

---

## Final verification

- [ ] `pnpm typecheck` — PASS
- [ ] `pnpm test` — PASS (includes updated `better-auth.guard` + new `roles.guard` specs)
- [ ] `pnpm lint` — clean
- [ ] Deferred (needs DB up): apply `better_auth_admin` migration; run `pnpm test:e2e` (auth + admin); boot the app and confirm `GET /api/auth/admin/list-users` works for an admin and is rejected for a non-admin.
- [ ] Docs: add a short "Admin (roles, ban, user management)" note to `CLAUDE.md`/`README.md` — endpoints under `/api/auth/admin/*`, seed via `ADMIN_USER_IDS`, protect Nest routes with `@Roles('admin')`.
