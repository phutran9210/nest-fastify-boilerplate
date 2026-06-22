# /coding-convention — Coding conventions for the NestJS + Fastify project

## Command description

This command has **two modes**:

- **Passive** (no `$ARGUMENTS`): Claude reads and applies this guide as an automatic reference when writing or reviewing code. No additional action needed — just comply.
- **Active** (`$ARGUMENTS` provided): Scans `.ts` files within the specified scope, lists violations in the format `file:line — violation → fix`, and auto-fixes when `--fix` is provided.

---

## Usage (Active mode)

```
/coding-convention <scope> [--fix] [--summary]
```

### Accepted scope values

| Argument       | Description                                                           |
|----------------|-----------------------------------------------------------------------|
| `<path>`       | Specific path (file or directory), e.g.: `src/modules/users`         |
| `all`          | Entire project (excluding `src/generated`)                           |
| `--changed`    | `.ts` files changed relative to base branch (`git diff $BASE...HEAD`)|
| `--dirty`      | Uncommitted + untracked (not yet committed, including unstaged new files) |
| `--staged`     | `.ts` files that have been `git add`ed (staged)                      |

### Modifier

| Modifier    | Description                                                    |
|-------------|----------------------------------------------------------------|
| `--fix`     | Auto-fix safe violations, then prompt to run `pnpm check`      |
| `--summary` | Return only the summary (no per-violation listing)              |

---

## Base branch detection logic (Active mode)

Use the following script to auto-detect the base branch — **do NOT hardcode `main`**:

```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

- `--changed` → `git diff --name-only $BASE...HEAD | grep '\.ts$'`
- `--dirty` → union of `git diff --name-only HEAD | grep '\.ts$'` and `git ls-files --others --exclude-standard | grep '\.ts$'`
- `--staged` → `git diff --name-only --cached | grep '\.ts$'`

**Always exclude `src/generated`** from all scan scopes (this is Prisma auto-generated code, ignored by Biome).

After using `--fix`, remind: **"Remember to run `pnpm check` to format and lint the entire project."**

---

## Project stack

**NestJS 11 + Fastify + Prisma 7 + nestjs-zod + Zod 4 + @js-temporal/polyfill + Biome 2.4.16 + Jest + pnpm**

Single-tenant. Module structure follows **feature-first** with clear layering:

- `src/common/` — cross-cutting concerns: `decorators/`, `filters/`, `guards/`, `interceptors/`
- `src/core/` — infrastructure: `config/`, `prisma/`, `queue/`, `messaging/`, `health/`
- `src/modules/` — business features, each feature with its own subfolders

---

## Conventions — Checklist

### 1. TypeScript & Biome

- ❌ **DO NOT use `any`** in production code (`src/`) — including `as any`. No "with comment" exceptions. (Exception: `any` is acceptable in test files `test/**` for test doubles — Biome only lints `src/**`.)
  - APIs without types (e.g. custom Lua command ioredis via `defineCommand`) → declare an explicit interface (see `RedisLockClient` in `src/core/redis/services/lock.service.ts`).
  - Need to cast through a different shape → go through `unknown` (`x as unknown as T`), NOT through `any`.
  - Zod's `z.any()` (e.g. the Date pattern in response DTOs) is a library runtime API — NOT TypeScript's `any` → still allowed.
- ✅ `import type` is **not required** — Biome has `useImportType` turned off.
- ✅ Use single quotes, trailing comma `all`, semicolon `always`, indent 2 spaces, lineWidth 100.
- ✅ Format/lint: `pnpm check` (= `biome check --write .`), `pnpm lint` (= `biome check .`).
- ⚠️ Biome `noExplicitAny` is currently off (not auto-enforced) — the no-`any` rule is enforced via review. A few legacy files (`rate-limit.service.ts`, `pubsub.service.ts`, `api-envelope.decorator.ts`) still have `any`; once cleaned up, `noExplicitAny` should be enabled in `biome.json`.

### 2. Imports & directory structure

- ✅ **Cross-module/layer imports use path aliases** — `@common/*`, `@core/*`, `@modules/*`, `@generated/*` (declared in `tsconfig.json` `paths`, `.swcrc` `jsc.paths`, `jest.config.js` `moduleNameMapper`)
- ✅ **Intra-module imports** still use short relative paths: `./`, `../dto/`, `../services/` — DO NOT use aliases
- ✅ Feature-first structure: each module lives in `src/modules/<feature>/` with subfolders:
  - `controllers/` — controller file(s)
  - `decorators/` — composite Swagger decorator (`<feature>-api.decorator.ts`)
  - `services/` — service file(s) and colocated `*.spec.ts` files
  - `dto/` — Zod DTO files
  - `repositories/` — port (abstract class) + Prisma impl (when DB access is needed)
  - `strategies/` — Passport strategies (auth only)
  - `jobs/` — BullMQ processors (mail/queue features only)
- ✅ Module file lives directly in `src/modules/<feature>/`: `<feature>.module.ts`
- ❌ DO NOT use `../../../` for cross-module/layer imports — use aliases instead
- ❌ Do not create barrel re-export files `index.ts` for modules

```ts
// ✅ Correct — intra-module uses relative, cross-module uses alias
import { UserRepository } from '../repositories/user.repository.port';
import { PrismaService } from '@core/prisma/prisma.service';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { User } from '@generated/prisma/client';

// ❌ Wrong — cross-module but still using ../../../
import { PrismaService } from '../../../core/prisma/prisma.service';
```

### 3. nestjs-zod & DTO

**Mandatory rule:** Use the pattern below. **Do NOT "simplify"** — the double cast is required for TypeScript to correctly infer the generic type.

```ts
// ✅ Correct — keep this pattern as-is
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export class CreateUserDto extends (createZodDto(createUserSchema) as ReturnType<
  typeof createZodDto<typeof createUserSchema>
>) {}
```

```ts
// ❌ Wrong — "simplifying" loses type inference
export class CreateUserDto extends createZodDto(createUserSchema) {}
```

- ✅ Controllers use `@ZodSerializerDto(Dto)` (arrays: `@ZodSerializerDto([Dto])`)
- ✅ Zod 4: use `z.email()` at top-level (DO NOT use `z.string().email()`)

```ts
// ✅ Correct (Zod 4)
email: z.email()

// ❌ Wrong (Zod 3 style)
email: z.string().email()
```

#### Important caveat — Date in response DTOs

`z.date()` crashes `z.toJSONSchema()` which nestjs-zod calls when building Swagger. **Mandatory** to use the following pattern, and **keep the explanatory comment**:

```ts
// ✅ Correct — response DTO with Date field
// Dates use `z.any().transform(...)` (Date -> ISO string) on purpose: `z.date()` is not
// representable by Zod v4's `z.toJSONSchema()`, which nestjs-zod calls to build the Swagger
// doc — using `z.date()` here crashes app bootstrap. Do not "simplify".
createdAt: z.any().transform((v: unknown) => (v instanceof Date ? v.toISOString() : String(v))),

// ❌ Wrong — crashes on app bootstrap
createdAt: z.date(),
```

### 4. Auth

- ✅ `JwtAuthGuard` is a global guard (`APP_GUARD`) — all endpoints are protected by default
- ✅ Public endpoints: use `@Public()` from `src/common/decorators/public.decorator.ts`
- ✅ Controllers requiring auth: require bearer for Swagger via `ApiBearerAuth()` placed **inside** the module's composite decorator (see section 5 below), NOT directly on the controller

```ts
// ✅ Public endpoint
import { Public } from '@common/decorators/public.decorator';

@Public()
@Get('health')
health() { ... }

// ✅ Protected controller — bearer is in ApiUsersController()
@ApiUsersController()
@Controller('users')
export class UsersController { ... }
```

### 5. Swagger — centralized in `decorators/`

- ✅ Each controller has a file `<module>/decorators/<feature>-api.decorator.ts` containing all Swagger metadata as composite `applyDecorators`
- ✅ Class-level: `Api<Feature>Controller()` — combines `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` if auth is needed)
- ✅ Per-endpoint: `Api<Action>()` — combines `ApiEnvelopeResponse(...)` and route-specific metadata
- ❌ Controllers MUST NOT `import` directly from `@nestjs/swagger` — only import `Api*()` from `decorators/`
- ✅ Applies to **every** controller, including routes that only have `ApiTags` (mail, notifications, health...)

```ts
// ✅ Correct — decorators/users-api.decorator.ts
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '@common/http/api-envelope.decorator';
import { UserResponseDto } from '../dto/user-response.dto';

export function ApiUsersController() {
  return applyDecorators(ApiTags('users'), ApiStandardErrorResponses(), ApiBearerAuth());
}
export function ApiCreateUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.CREATED }));
}

// ❌ Wrong — Swagger decorators scattered across the controller
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController { ... }
```

### 6. HTTP status — explicit `@HttpCode` + synced with Swagger

- ✅ **Every** HTTP route must declare `@HttpCode(HttpStatus.X)` explicitly (imported from `@nestjs/common`) — DO NOT rely on Nest's implicit defaults (POST→201, others→200)
- ✅ `status` in `ApiEnvelopeResponse(..., { status: HttpStatus.X })` uses the **same** `HttpStatus.X` as `@HttpCode` → runtime and Swagger always match
- ❌ DO NOT use magic numbers (`200`, `201`, `202`) — always use the `HttpStatus` enum
- Convention: creating a resource → `CREATED`; read/update/delete returning body → `OK`; async action (enqueue/publish) → `ACCEPTED`

```ts
// ✅ Correct — @HttpCode matches status in decorator
import { HttpCode, HttpStatus } from '@nestjs/common';

@Post()
@HttpCode(HttpStatus.CREATED)   // runtime 201
@ApiCreateUser()                // ApiEnvelopeResponse(..., { status: HttpStatus.CREATED })
create(@Body() dto: CreateUserDto) { ... }

// ❌ Wrong — no @HttpCode declared (relying on default), or magic number mismatched with docs
@Post()
@ApiCreateUser()  // docs 201 but runtime also 201 by luck — still FAILS because @HttpCode is missing
create(@Body() dto: CreateUserDto) { ... }
```

### 7. Data access — Repository port pattern

- ✅ **Service injects PORT** (`abstract class <Feature>Repository`) — DO NOT inject `PrismaService` directly
- ✅ **Naming by role (suffix)**: PORT = `<feature>.repository.port.ts`, IMPL = `<feature>.repository.prisma.ts` — the file suffix immediately reveals the role (switching adapter → `.mongo.ts`, `.http.ts`...)
- ✅ **Port** (`repositories/<feature>.repository.port.ts`) is an `abstract class <Feature>Repository` — serves as both TS type AND DI token; re-exports model type via `export type { <Model> }`; defines `Create<Feature>Data` and `Update<Feature>Data`
- ✅ **Prisma impl** (`repositories/<feature>.repository.prisma.ts`) is `@Injectable() Prisma<Feature>Repository extends <Feature>Repository` — the ONLY file that imports `PrismaService` and `generated/prisma`
- ✅ **Module wiring**: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`
- ✅ Service imports model types FROM PORT (not directly from `generated/prisma`)
- ❌ Service MUST NOT call `this.prisma.*` or import `generated/prisma`

```ts
// ✅ Correct — port (repositories/user.repository.port.ts)
export type { User };
export type CreateUserData = { email: string; password: string; name?: string | null };
export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract create(data: CreateUserData): Promise<User>;
  // ...
}

// ✅ Correct — Prisma impl (repositories/user.repository.prisma.ts)
import { PrismaService } from '@core/prisma/prisma.service';
import type { User } from '@generated/prisma/client';
@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) { super(); }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }); }
}

// ✅ Correct — service injects PORT
import { type User, UserRepository } from '../repositories/user.repository.port';
@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}
}

// ✅ Correct — module wiring
{ provide: UserRepository, useClass: PrismaUserRepository }

// ❌ Wrong — service injects PrismaService directly
constructor(private readonly prisma: PrismaService) {}
```

Prisma errors are handled in the Prisma impl via `Prisma.PrismaClientKnownRequestError`:
- `P2002`: unique constraint
- `P2025`: record not found
- `P2003`: foreign key constraint

Multi-step writes use `prisma.$transaction([...])` or `$transaction(async (tx) => ...)` inside the Prisma impl.

### 8. Date/Time — Temporal API

Use `@js-temporal/polyfill` for all date/time logic. **Do NOT use `new Date()`** for date logic.

```ts
// ✅ Correct
import { Temporal, toTemporalInstant } from '@js-temporal/polyfill';

const now = Temporal.Now.instant();
const today = Temporal.Now.plainDateISO();
const expiresAt = Temporal.Now.instant().add({ hours: 1 });

// Convert Prisma Date to Temporal — use toTemporalInstant (function import)
const instant = toTemporalInstant.call(someDate);

// ❌ Wrong — do not call as a method on a Date instance
const instant = someDate.toTemporalInstant();

// ❌ Wrong — do not use new Date() for date logic
const now = new Date();
const expires = new Date(Date.now() + 3600 * 1000);
```

> **Note:** Prisma `DateTime` columns still return JS `Date` objects. Only convert to Temporal when computation is needed.

### 9. Testing (Jest)

- ✅ `*.spec.ts` files are **placed in the same directory** as the source (colocated), not in `__tests__/`
  - Service specs go in `services/`: `services/<feature>.service.spec.ts`
- ✅ Mocks = plain object + `useValue` in `Test.createTestingModule`
- ✅ Mock the **repository PORT** (not `PrismaService`) in service tests
- ✅ `jest.clearAllMocks()` in `beforeEach`
- ✅ Test names describe **behavior** — "should ... when ..." format is not mandatory
- ✅ Specific assertions: `toHaveBeenCalledWith`, `rejects.toBeInstanceOf`, `rejects.toMatchObject({ status: 404 })`
- ❌ Do not use `jest.mock` at the top-level module
- ❌ `// Arrange / Act / Assert` comments are not mandatory
- ❌ Do not place spec files in `__tests__/`

```ts
// ✅ Correct — mock repository PORT
describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserRepository, useValue: repo },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('throws NotFoundException when user is not found', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

---

## Output Format (Active mode)

### Violation list (default)

```
src/modules/users/services/users.service.ts:42 — Using `new Date()` for date logic → Replace with `Temporal.Now.instant()`
src/modules/users/dto/create-user.dto.ts:8 — `z.string().email()` (Zod 3 style) → Use `z.email()` (Zod 4)
src/modules/auth/services/auth.service.ts:15 — `z.date()` in response DTO will crash bootstrap → Use `z.any().transform(...)`
```

Format per line: `file:line — violation → fix`

### Summary

```
Summary:
  Files scanned:          12
  Clean files:             9
  Files with violations:   3
  Total violations:        5
```

- `--summary`: returns only the summary, no per-violation listing.
- `--fix`: auto-fixes safe violations, then prompts: **"Remember to run `pnpm check` to format and lint the entire project."**

---

## What does NOT belong in this project

The following patterns **must NOT be used** — they belong to other/older projects:

- Decorator-based ORM (Active Record / Data Mapper with entity classes and injected repositories)
- Legacy date/time libraries (momentjs, libraries starting with "day")
- Class-based validation decorators (validation-by-decorator on properties)
- Multi-tenant / organization-partitioned architecture (org/tenant)
- Centralized constants for error messages or constraints (e.g. `ERRORS`, `LIMITS` objects)
- Barrel re-export files for each module
- `register-as` factory config from `@nestjs/config` (not used in this project)
- Hardcoded branch names in git diff ranges — always use the `$BASE` variable instead of a fixed branch name
- Injecting `PrismaService` directly into services — must go through the repository port
- Flat structure skipping subfolders — always use feature-first layout with `controllers/`, `services/`, `repositories/`, `dto/`
