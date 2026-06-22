# /review-code — Code quality review (NestJS 11 + Fastify + Prisma 7)

## Parameters

`$ARGUMENTS` can be:
- A specific path (file or directory)
- `all` — entire source
- `--changed` — files changed compared to the base branch
- `--dirty` — uncommitted + untracked files
- `--staged` — files already `git add`ed
- `--fix` — automatically fix safe issues, then run `pnpm check`
- `--summary` — only print the SUMMARY section

## Determining scope

```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

- `--changed` → `git diff --name-only $BASE...HEAD`
- `--dirty` → union of `git diff --name-only HEAD` and `git ls-files --others --exclude-standard`
- `--staged` → `git diff --name-only --cached`
- Always exclude `src/generated/`. Only consider `.ts` files.

---

## Evaluation criteria

For each criterion, record the result: **PASS** / **WARN** / **FAIL** with specific location `file:line — issue → fix`.

This project is **single-tenant**. There is nothing to evaluate regarding multi-tenant schemas, no legacy ORM migrations. Completely skip any concepts that do not apply to this stack.

---

### 1. Correctness

Check:
- Logic matches intent: no incorrect condition reasoning, no inverted booleans
- Handle `null` from `prisma.findUnique` (check before use)
- Empty arrays do not cause runtime errors
- Pagination has no off-by-one (`skip = (page - 1) * limit`)
- All Promises have proper `await`

Example issue:
```ts
// FAIL: missing await
const user = prisma.user.findUnique({ where: { id } });
// → add await
```

---

### 2. Security

Check:
- Auth is **opt-out**: global `JwtAuthGuard` protects all routes. Only use `@Public()` (from `src/common/decorators/public.decorator.ts`) for genuinely public endpoints.
- **WARN/FAIL** if `@Public()` is placed on sensitive endpoints (password change, admin actions, etc.)
- Sensitive data hiding (e.g. `password`) is handled **primarily** via `@ZodSerializerDto(<Feature>ResponseDto)` — the DTO response schema strips sensitive fields. Returning the full Prisma entity is **acceptable** when the response DTO already filters correctly.
- `select` in Prisma is a **recommended** safeguard (defense-in-depth, not mandatory) — do not mandate `select` if `@ZodSerializerDto` already handles it.
- No hardcoded secrets: use `ConfigService`, do not put real values in source code.

Example issue:
```ts
// FAIL: @Public() on password change endpoint
@Public()
@Patch('change-password')
```

---

### 3. Error Handling

Check:
- Services throw NestJS exceptions (`NotFoundException`, `BadRequestException`, `ConflictException`, ...)
- Controllers do **NOT** try/catch and silently swallow errors
- Prisma errors handled via `Prisma.PrismaClientKnownRequestError` with correct codes:
  - `P2002` → unique constraint violation → `ConflictException`
  - `P2025` → record not found → `NotFoundException`
  - `P2003` → foreign key constraint → `BadRequestException`

Example issue:
```ts
// FAIL: not handling PrismaClientKnownRequestError
catch (e) {
  throw new InternalServerErrorException();
}
// → classify by e.code (P2002, P2025, P2003)
```

---

### 4. Data Integrity

Check:
- Multi-step write sequences must be wrapped in `prisma.$transaction`
- Unique constraints are enforced at the DB layer (Prisma schema)
- No intermediate state left if a step fails

Example issue:
```ts
// FAIL: two separate writes without a transaction
await prisma.order.create({ ... });
await prisma.inventory.update({ ... });
// → wrap in prisma.$transaction([...])
```

---

### 5. Performance

Check:
- No N+1: use `include` or `select` instead of looping queries
- List endpoints have pagination (`take` + `skip` or cursor)
- No fetching entire large tables into memory

Example issue:
```ts
// FAIL: N+1
for (const post of posts) {
  post.author = await prisma.user.findUnique({ where: { id: post.authorId } });
}
// → use prisma.post.findMany({ include: { author: true } })
```

---

### 6. Prisma & Query Quality

Check:
- Prisma error codes are handled correctly (see criterion 3)
- Transaction scope does **NOT** include external HTTP calls or job queue operations — only DB operations
- `select` is **recommended** (not mandatory / not mandated) — do NOT FAIL for missing `select` if the DTO already handles it

Example issue:
```ts
// FAIL: external HTTP call inside transaction
await prisma.$transaction(async (tx) => {
  await tx.order.create({ ... });
  await httpService.post('/notify', { ... }); // wrong
});
```

---

### 7. API Design

Check:
- REST conventions: `POST /resource` → 201, `GET /resource/:id` → 200, `DELETE` → 200 or 204
- **Centralized Swagger decorators**: all Swagger metadata lives in `<module>/decorators/<feature>-api.decorator.ts` as composite `applyDecorators` (class-level `Api<Feature>Controller()` + per-endpoint `Api<Action>()`). Controllers MUST NOT import directly from `@nestjs/swagger` — FAIL if they do
- Each route has a composite decorator documenting the response envelope; controller-level has tag + `ApiStandardErrorResponses` (+ `ApiBearerAuth` if auth required)
- **Explicit `@HttpCode(HttpStatus.X)` on EVERY route** — FAIL if relying on Nest's implicit default status. `status` in `ApiEnvelopeResponse(..., { status: HttpStatus.X })` must use the same `HttpStatus.X` as `@HttpCode`; FAIL if using magic numbers or if runtime and docs diverge
- Controllers must not return raw entities without a response DTO

Example issue:
```ts
// FAIL: Swagger decorators scattered in controller, directly importing @nestjs/swagger
import { ApiTags, ApiCreatedResponse } from '@nestjs/swagger';
@ApiTags('users')
@Controller('users')
// → move to decorators/users-api.decorator.ts: @ApiUsersController() + @ApiCreateUser()

// FAIL: missing @HttpCode → runtime uses implicit default, easily diverges from docs status
@Post('login')
@ApiLogin() // docs say 200 but POST defaults to 201 → mismatch
login(@Body() dto: LoginDto) { ... }
// → add @HttpCode(HttpStatus.OK) to match
```

---

### 8. Readability

Check:
- Variable/function names are clear, no cryptic abbreviations
- Small functions with single responsibility
- No magic numbers (use named constants)
- No dead code (dead code, unused imports)

Example issue:
```ts
// WARN: magic number
if (users.length > 100) { ... }
// → const MAX_BATCH_SIZE = 100;
```

---

### 9. Testing

Check:
- `*.spec.ts` files placed in the same directory as the file being tested (colocated)
- Mocks use plain object `useValue` (no `jest.mock` module-level when not needed)
- Has `jest.clearAllMocks()` in `beforeEach` or `afterEach`
- Specific assertions (not just `expect(result).toBeDefined()`)
- Test names describe behavior, not required to follow `should ... when ...` format

Example issue:
```ts
// WARN: overly generic assertion
expect(result).toBeDefined();
// → expect(result.id).toBe(mockUser.id);
```

---

### 10. Architecture & Layering

Check adherence to feature-first architecture and repository port pattern:

- **`common/` vs `core/`**: cross-cutting concerns (decorators, filters, guards, interceptors) belong in `src/common/`; infrastructure (config, prisma, queue, messaging, health) belongs in `src/core/`. FAIL if placed in the wrong layer.
- **Services MUST NOT call `this.prisma.*` directly** and MUST NOT import from `generated/prisma` — FAIL if violated.
- **Only `<feature>.repository.prisma.ts`** may import `PrismaService` and `generated/prisma` — FAIL if a service or controller does this.
- **Repository naming by role**: PORT = `<feature>.repository.port.ts`, IMPL = `<feature>.repository.prisma.ts` — WARN if using old names (`<feature>.repository.ts` / `prisma-<feature>.repository.ts`).
- **Port-to-impl wiring exists** in the module: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }` — FAIL if missing, since NestJS will not be able to resolve the dependency.
- **Services inject PORT** (abstract class), not the impl directly — WARN if injecting impl.
- Correct directory structure: `controllers/`, `services/`, `repositories/`, `dto/` — WARN if files are flat at the module root.

Example issue:
```ts
// FAIL: service importing PrismaService directly
import { PrismaService } from '../../../core/prisma/prisma.service';
constructor(private readonly prisma: PrismaService) {}
// → Create repository port + impl; service only injects PORT

// FAIL: missing wiring in module
providers: [ProductsService, PrismaProductRepository]
// → providers: [ProductsService, { provide: ProductRepository, useClass: PrismaProductRepository }]
```

---

### 11. Project Conventions

Defer to the `/coding-convention` command for the full convention checklist. Here only check:
- Biome format/lint (run `pnpm check` or `pnpm lint`)
- Import aliases match the correct layer (`@common/*`, `@core/*`, `@modules/*`, `@generated/*` when crossing modules; relative within the same module)
- **NO `any`** in production code (`src/`) — including `as any`. This is a hard rule with no "with comment" exceptions. When calling an API without types (e.g. custom Lua commands in ioredis registered via `defineCommand`), **declare an explicit interface** for it instead of casting to `any`; when needing to cast through a different shape, go through `unknown` (`x as unknown as T`), NOT through `any`. **FAIL** for every occurrence of the `any` token in `src/`. Exception: **`any` is accepted in test files** (`test/**`, `*.spec.ts`) for test doubles — do NOT flag. Note: Zod's `z.any()` (e.g. the Date pattern in response DTOs) is a library runtime API, NOT TypeScript's `any` — does not count as a violation.

---

## Result format

For each criterion:

```
### [Number]. Criterion name — PASS | WARN | FAIL
- src/modules/user/user.service.ts:42 — specific issue → fix
```

---

## SUMMARY

```
CRITICAL: X issues
HIGH:     X issues
MEDIUM:   X issues
LOW:      X issues

TOP 3 priorities:
1. [CRITICAL/HIGH] file:line — short description
2. ...
3. ...
```

Severity levels:
- **CRITICAL** — security vulnerability, potential data loss, unhandled crash
- **HIGH** — incorrect logic, improperly caught errors, severe N+1
- **MEDIUM** — missing validation, missing Swagger, missing test coverage
- **LOW** — readability, minor conventions

---

## Special flags

- `--fix`: Automatically fix safe issues (format, unused imports, unclear Swagger annotations). Then run `pnpm check` and report the results.
- `--summary`: Only print the SUMMARY section, skip the per-criterion details.
