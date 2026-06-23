# Better Auth Admin Plugin — Design

**Date:** 2026-06-23
**Status:** Approved (pending implementation plan)
**Scope:** Add the Better Auth `admin()` plugin (roles, user management, banning) to the existing Better Auth integration, plus a Nest `@Roles()` / `RolesGuard` for role-protecting Nest routes.
**Builds on:** `docs/superpowers/specs/2026-06-23-better-auth-integration-design.md` (the base Better Auth integration is implemented on branch `feat/better-auth`).

---

## 1. Goals & Decisions

| Decision | Choice |
|---|---|
| Access control model | **Default roles** (`user` / `admin`) + plugin default permissions. No custom `ac`/`roles`. |
| Scope | **API + Nest RolesGuard** — enable `/api/auth/admin/*` endpoints AND add `@Roles()` + a global `RolesGuard`. No admin UI, no extra Nest admin endpoints. |
| Seed first admin | **`adminUserIds`** from env (`ADMIN_USER_IDS`), passed to `admin({ adminUserIds })`. |
| Impersonation | **Skipped (YAGNI)** — not used/surfaced. (Cannot be fully blocked without custom AC — see §6.) |

---

## 2. Architecture

The `admin()` plugin is added to the shared `plugins` array in `auth-options.ts`. Because the Better Auth handler is already mounted as a Fastify catch-all at `/api/auth/*` (base integration), **all admin endpoints are served automatically** with no `main.ts` change:

```
/api/auth/admin/list-users | create-user | set-role | ban-user | unban-user
                | remove-user | list-user-sessions | ...   → Better Auth (role-checked internally)

Nest routes → BetterAuthGuard (global, runs 1st) — sets req.user = { userId, email, role }
            → RolesGuard      (global, runs 2nd) — no @Roles ⇒ allow;
                                                    @Roles ⇒ allow if role matches OR userId ∈ ADMIN_USER_IDS;
                                                    else 403
```

Authorization for the admin endpoints themselves is enforced **inside** Better Auth (caller must have an admin role or be in `adminUserIds`). The Nest `RolesGuard` is a reusable primitive for protecting Nest-side routes (none required today; ready for future admin-only routes).

---

## 3. Components

### 3.1 Plugin config — `src/core/auth/auth-options.ts`

- Import `admin` from `better-auth/plugins`; add to `plugins`:
  ```ts
  plugins: [
    bearer(),
    admin({ defaultRole: 'user', adminRoles: ['admin'], adminUserIds: env.adminUserIds }),
  ]
  ```
- Extend `AuthEnv` with `adminUserIds: string[]`.
- `auth.ts` (runtime factory) reads `adminUserIds` from `ConfigService` (`ADMIN_USER_IDS`).
- `auth.cli.ts` (schema generation) passes `adminUserIds: []` (it does not affect the generated schema).

### 3.2 Env — `src/core/config/env.schema.ts`

- Add `ADMIN_USER_IDS` — optional CSV transformed to `string[]`, mirroring the existing `ALLOWED_ORIGINS` pattern (absent ⇒ `[]`).

### 3.3 Prisma schema — `prisma/schema.prisma`

The admin plugin extends the schema. Regenerate via `npx @better-auth/cli generate --config src/core/auth/auth.cli.ts` (source of truth), then migrate. Expected additions:
- `User`: `role String? @default("user")`, `banned Boolean? @default(false)`, `banReason String?`, `banExpires DateTime?`.
- `Session`: `impersonatedBy String?`.

Run: `pnpm prisma:generate && pnpm prisma:migrate --name better_auth_admin`. (Requires Postgres up.)

### 3.4 `AuthUser` + guard — role propagation

- `src/common/decorators/current-user.decorator.ts`: add `role?: string` to the `AuthUser` interface.
- `src/common/guards/better-auth.guard.ts`: set `req.user = { userId: session.user.id, email: session.user.email, role: session.user.role }`. (`getSession` returns `UserWithRole` once the admin plugin is active, so `session.user.role` is typed/available.) Update the existing guard unit test to assert the `role` field.

### 3.5 `@Roles()` decorator — `src/common/decorators/roles.decorator.ts` (new)

```ts
import { SetMetadata } from '@nestjs/common';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

### 3.6 `RolesGuard` — `src/common/guards/roles.guard.ts` (new), global `APP_GUARD`

- Injects `Reflector` + `ConfigService`.
- Logic: non-HTTP ⇒ allow. Read `@Roles` via `reflector.getAllAndOverride(ROLES_KEY, [handler, class])`; if none ⇒ allow. Else read `req.user` (set by `BetterAuthGuard`); allow if `req.user.role` is in the required roles **OR** `req.user.userId ∈ ADMIN_USER_IDS` (read from config); otherwise throw `ForbiddenException`.
- Registered in `app.module.ts` as a second `APP_GUARD` **after** `BetterAuthGuard` (Nest runs `APP_GUARD`s in registration order; `BetterAuthGuard` must populate `req.user` first).

### 3.7 No Nest admin endpoints

Per the chosen scope, user management (list/create/set-role/ban/remove) flows through `/api/auth/admin/*` directly. No Nest controllers/DTOs are added. The Users module stays read-only.

---

## 4. Data Flow

**Promote/seed an admin:** add the user's id to `ADMIN_USER_IDS` (env) — they are treated as admin by both Better Auth (`adminUserIds`) and the Nest `RolesGuard`. To make a persistent DB-role admin, call `POST /api/auth/admin/set-role` (from an existing admin) to set `role='admin'`.

**Admin action (e.g. ban):** admin client → `POST /api/auth/admin/ban-user` → Better Auth verifies caller is admin → sets `banned`/`banReason`/`banExpires`, revokes the target's sessions. The banned user's subsequent `getSession` returns null ⇒ `BetterAuthGuard` rejects them on every Nest route automatically (no extra code).

**Protect a Nest route (future):** annotate a handler with `@Roles('admin')` → `RolesGuard` enforces it.

---

## 5. Testing

- **Unit `RolesGuard`** (`test/unit/common/guards/roles.guard.spec.ts`): non-http ⇒ allow; no `@Roles` ⇒ allow; `role` matches ⇒ allow; `userId ∈ ADMIN_USER_IDS` ⇒ allow even if role mismatches; role mismatch + not in adminUserIds ⇒ `ForbiddenException`.
- **Update `BetterAuthGuard` unit test**: the valid-session case now asserts `req.user.role`.
- **Update `env.schema` unit test** only if needed (new var is optional with a default).
- **E2e (deferred — needs DB):** seed an admin via `ADMIN_USER_IDS`, sign in, call `GET /api/auth/admin/list-users` → 200; a non-admin gets 401/403. Deferred to a live-infra run like the base integration's e2e.

---

## 6. Known Limitations / Tradeoffs

1. **Impersonation cannot be fully disabled with default roles.** The default `admin` role carries impersonation permission, so `/api/auth/admin/impersonate-user` remains reachable by admins. We do not use or surface it; fully removing it requires custom access control (`ac`/`roles`), which was deliberately out of scope. Documented, accepted.
2. **`adminUserIds` does not set the DB `role` field.** It grants admin in Better Auth's checks only. The Nest `RolesGuard` compensates by also treating `userId ∈ ADMIN_USER_IDS` as admin, keeping seeding consistent across both sides. To get a DB-persisted `role='admin'`, use `set-role`.
3. **Global `RolesGuard` is inert without `@Roles`.** With no `@Roles` annotations today it always allows — it is infrastructure for future admin-only Nest routes. Acceptable (matches the project's global-guard convention; zero runtime cost on unannotated routes).

---

## 7. Out of Scope (YAGNI)

- Custom access control / fine-grained permissions / `superadmin`.
- Impersonation feature work.
- Admin UI and bespoke Nest admin controllers/DTOs.
- Roles beyond `user`/`admin`.
