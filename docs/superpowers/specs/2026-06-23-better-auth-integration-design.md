# Better Auth Integration — Design

**Date:** 2026-06-23
**Status:** Approved (pending implementation plan)
**Scope:** Full replacement of the existing passport-jwt authentication with [Better Auth](https://www.better-auth.com/) in the NestJS 11 + Fastify + Prisma 7 project.

---

## 1. Goals & Decisions

| Decision | Choice |
|---|---|
| Relationship to existing auth | **Full replacement** — remove passport-jwt entirely |
| Features | Email + password, social providers, email verification, bearer/JWT plugin |
| Social providers | **Google** + **Facebook** (each registered only if its env credential pair is present) |
| Integration style | **Manual / native** — mount Better Auth's handler on a Fastify route; custom global guard via `auth.api.getSession()` (no `@thallesp/nestjs-better-auth`, no Express coupling) |
| Existing user data | **Fresh schema** — no data migration; DB reset |
| `user.registered` event | **Best-effort** via `databaseHooks.user.create.after` → outbox enqueue (accepted non-atomic window) |
| Users CRUD endpoints | **Read-only** — keep `GET` list + `GET :id`; remove `POST`/`PATCH`/`DELETE` so nothing bypasses Better Auth |
| `JWT_SECRET` / `JWT_EXPIRES_IN` | **Dropped** (only referenced by replaced auth files) |

---

## 2. Architecture

Better Auth is the single source of truth for authentication. Its handler is mounted as a **native Fastify catch-all at `/api/auth/*`**, outside Nest's controller layer. All sign-up / sign-in / social / verify-email / session endpoints are served by Better Auth directly. Nest keeps a **global guard** that validates the Better Auth session on every other route.

```
Client ──▶ Fastify
            ├─ /api/auth/*      → Better Auth handler (auth.handler(Request) Fetch bridge)
            └─ everything else  → Nest pipeline
                                   └─ BetterAuthGuard (global APP_GUARD, replaces JwtAuthGuard)
                                        auth.api.getSession({ headers }) → req.user / req.session
```

**Session model:** cookie-based DB sessions (browser) **plus** bearer tokens (via the `bearer()` plugin) for non-browser clients. `@CurrentUser()` keeps returning `{ userId, email }` — existing controllers need no change.

**Bearer client contract:** after a successful `POST /api/auth/sign-in/email`, Better Auth returns the token in the **`set-auth-token` response header**. Non-browser clients store it and send it on subsequent requests as `Authorization: Bearer <token>`. `BetterAuthGuard` resolves both cookie and bearer credentials through the same `auth.api.getSession({ headers })` call (the `bearer()` plugin reads the `Authorization` header), so no guard branching is needed.

---

## 3. Components

### 3.1 Better Auth instance — `src/core/auth/`

A new core module. The `auth` instance is created by a **factory provider** so it can inject existing infrastructure:

- **Files:**
  - `src/core/auth/auth.ts` — `createAuth(deps)` factory returning a configured `betterAuth(...)` instance; exports an `AUTH_INSTANCE` DI token and the inferred `Auth` type.
  - `src/core/auth/auth.module.ts` — `@Global()` module providing `AUTH_INSTANCE` (factory injects `PrismaService`, `MailProducer`, `OutboxRepository`, `ConfigService`); **imports `MailProducerModule` and `OutboxModule.forProducer()`** (neither is global, and `OutboxModule` only exports `OutboxRepository` via `forProducer()`); exports `AUTH_INSTANCE`.
- **Config:**
  - `database: prismaAdapter(prisma, { provider: 'postgresql' })` — reuses `PrismaService` (the `PrismaClient` Proxy instance).
  - `secret: BETTER_AUTH_SECRET`, `baseURL: BETTER_AUTH_URL`, `basePath: '/api/auth'`, `trustedOrigins` from env.
  - `emailAndPassword: { enabled: true, requireEmailVerification: true }`.
  - `emailVerification.sendVerificationEmail({ user, url })` → `mailProducer.enqueue({ to, subject, body: url })`. Reuses the existing BullMQ `mail` queue → worker sends the email. No new mail infra.
  - `socialProviders`: `google` and `facebook`, each spread in **only when** both client id + secret env vars are present.
  - `plugins: [bearer()]`.
  - `databaseHooks.user.create.after(user)` → the injected `OutboxRepository.enqueue({ routingKey: 'user.registered', payload: { userId, email, name } })`. Best-effort (see §6).

> Note: `AppModule` already imports `OutboxModule.forProducer()`. `AuthModule` importing it again is fine — `forProducer()` returns a normal (non-global) module; the `OutboxRepository` provider is shared via Nest's module graph. If `forProducer()` is not idempotent for repeated imports, the factory instead injects `OutboxRepository` directly and `AuthModule` is listed where `OutboxModule.forProducer()` is already in scope — to be confirmed during implementation.

### 3.2 Global guard — `BetterAuthGuard`

Replaces `JwtAuthGuard` at `src/common/guards/`. Injects `Reflector` + `AUTH_INSTANCE`.

```ts
canActivate(ctx):
  if (ctx.getType() !== 'http') return true;          // skip RMQ/microservice handlers
  if (@Public on handler/class) return true;
  const req = ctx.switchToHttp().getRequest();
  const session = await auth.api.getSession({ headers: fromNodeHeaders(req.headers) });
  if (!session) throw new UnauthorizedException();
  req.user = { userId: session.user.id, email: session.user.email };
  req.session = session;
  return true;
```

`@Public()` and `@CurrentUser()` decorators are **unchanged** (`@CurrentUser()` still reads `req.user`).

### 3.3 Fastify mounting — `main.ts`

Use the **documented Better Auth Fastify integration** (`auth.handler(Request)` Fetch bridge) — **not** `toNodeHandler` and **not** a raw-stream/`reply.hijack()` approach. This relies on Fastify's normal body parsing, so **no content-type parser override** is needed and Nest's `@Body()` routes (`users`, `mail`, …) are untouched.

Steps (registered **before** `app.listen()`, after `app.get(AUTH_INSTANCE)` resolves):

```ts
const auth = app.get(AUTH_INSTANCE);
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

- **CORS:** change `app.enableCors()` → `app.enableCors({ origin: <ALLOWED_ORIGINS or true in dev>, credentials: true })` so session cookies and the `set-auth-token` header work cross-origin.
- Forwarding `response.headers` verbatim is what carries Better Auth's `Set-Cookie` **and** `set-auth-token` (bearer) headers back to the client — do not filter them.

### 3.4 Nest `AuthModule` rewrite — `src/modules/auth/`

- **Delete:** `services/auth.service.ts`, `strategies/jwt.strategy.ts`, `controllers/auth.controller.ts` (login/register), `dto/login.dto.ts`, `dto/login-response.dto.ts`, `dto/register.dto.ts`, the `@nestjs/jwt`/`JwtModule` wiring.
- **Keep:** a thin module exposing `GET /auth/me` (session-backed, returns `@CurrentUser()`), with its centralized Swagger decorator in `decorators/`. `auth-user-response.dto.ts` is reused/adapted.
- The bcrypt/JWT register+login flow is fully superseded by Better Auth's `/api/auth/sign-up/email` and `/api/auth/sign-in/email`.

### 3.5 Prisma schema — fresh, no migration

Replace current `User` (drop `password`) with Better Auth's standard models; keep `OutboxEvent`.

**The `@better-auth/cli generate` output is the source of truth for these models** — including required vs optional fields, relation fields, `onDelete: Cascade` relations, indexes, and any `@@map(...)` table mappings. The bullets below are an **illustrative** summary of the shape, **not** a literal schema to hand-write:

- **`User`**: `id`, `name`, `email @unique`, `emailVerified Boolean`, `image?`, `createdAt`, `updatedAt` (+ relations to `Session`/`Account`).
- **`Session`**: `id`, `expiresAt`, `token @unique`, `ipAddress?`, `userAgent?`, `userId` → `User` (cascade), timestamps.
- **`Account`**: `id`, `accountId`, `providerId`, `userId` → `User` (cascade), `accessToken?`, `refreshToken?`, `idToken?`, `accessTokenExpiresAt?`, `refreshTokenExpiresAt?`, `scope?`, `password?` (credential hash), timestamps.
- **`Verification`**: `id`, `identifier`, `value`, `expiresAt`, timestamps.

Process: run `npx @better-auth/cli generate` (writes models into `schema.prisma`), review the diff, then `pnpm prisma:generate` + `pnpm prisma:migrate` with a DB reset.

### 3.5.1 Users module — read-only

Better Auth owns identity, so the Users module is reduced to **read-only**:

- **Keep:** `GET /users` (list) and `GET /users/:id`.
- **Remove:** `POST /users` (creation goes through `/api/auth/sign-up/email`), `PATCH /users/:id`, `DELETE /users/:id` — and their DTOs (`CreateUserDto`, `UpdateUserDto`) and the corresponding `UsersService` methods (`create`, `update`, `remove`). Repository methods left unused after this are removed too.
- The `user-response.dto.ts` and the `User` model type are cleaned of `password`. User management / admin operations are out of scope (can be added later via Better Auth's admin plugin).

### 3.6 Env schema — `src/core/config/env.schema.ts`

- **Add:** `BETTER_AUTH_SECRET` (`z.string().min(32)`), `BETTER_AUTH_URL` (`z.url()`, default `http://localhost:3000`), `ALLOWED_ORIGINS` (optional CSV → `trustedOrigins` + CORS), `GOOGLE_CLIENT_ID?`, `GOOGLE_CLIENT_SECRET?`, `FACEBOOK_CLIENT_ID?`, `FACEBOOK_CLIENT_SECRET?`.
- **Remove:** `JWT_SECRET`, `JWT_EXPIRES_IN`.
- **superRefine:** if one half of a social provider pair is set, require the other half (no half-configured provider). (`BETTER_AUTH_SECRET` is already non-optional, so no extra production check is needed.)

### 3.7 Worker process

No auth routes on the worker. Better Auth runs only in the API process. The worker's outbox relay continues to publish `user.registered`, and the worker's `mail` processor continues to send verification emails. **No worker changes** beyond the shared env schema (which both processes validate).

---

## 4. Data Flow

**Sign-up (email/password):**
`POST /api/auth/sign-up/email` → Better Auth creates `User` + credential `Account` → `user.create.after` hook enqueues `user.registered` outbox event → `requireEmailVerification` triggers `sendVerificationEmail` → BullMQ `mail` job → worker sends email. Worker outbox relay later publishes `user.registered` to RabbitMQ.

> Behavior change: Better Auth's `sign-up/email` **requires `name`** (the old register DTO treated it as optional). `User.name` is therefore non-optional in the generated schema, and the `user.registered` payload always carries a `name`. The existing `user.registered` messaging contract (`@core/messaging`) needs no change — it already accepts the `{ userId, email, name }` shape.

**Sign-in (email/password):** `POST /api/auth/sign-in/email` → sets session cookie (and bearer token available via the `bearer()` plugin / `Authorization` header on subsequent requests).

**Social sign-in:** `GET /api/auth/sign-in/social` (google|facebook) → OAuth redirect → callback creates/links `Account` + `User` → session.

**Protected Nest route:** request → `BetterAuthGuard.getSession()` → `req.user` → `@CurrentUser()`.

---

## 5. Testing

- **Unit:** `BetterAuthGuard` spec (mock `AUTH_INSTANCE.api.getSession` for public / authed / unauthed / non-http). Update Users unit tests for the dropped `password` field and the removed `create`/`update`/`remove` methods.
- **E2E — cookie flow:** sign-up → (stub/verify) → sign-in via `/api/auth/*`; assert a protected route returns 401 without a session and 200 with the session cookie.
- **E2E — bearer flow (separate test):** sign-in, capture the **`set-auth-token`** response header, then call a protected route with `Authorization: Bearer <token>` (no cookie) and assert 200. This proves bearer auth works independently of cookies.
- Remove obsolete `auth.service` spec and any old `/auth/login` / `/auth/register` E2E flows.

---

## 6. Known Limitations / Tradeoffs

1. **`user.registered` is best-effort.** The old flow wrote user + outbox event in one Prisma transaction. Better Auth's `create.after` hook runs just outside the user insert, so there is a small non-atomic window. Accepted by the user.
2. **Better Auth routes are outside Nest Swagger.** `/api/auth/*` won't appear in `/docs`. Documented in README; the optional Better Auth OpenAPI plugin can be added later.
3. **Fresh schema only.** No migration path for pre-existing users (no production data).

---

## 7. Out of Scope (YAGNI)

- 2FA, magic link, passkey, organization/teams plugins.
- Apple / GitHub providers.
- Migrating existing user passwords.
- Better Auth OpenAPI plugin (can follow later).
