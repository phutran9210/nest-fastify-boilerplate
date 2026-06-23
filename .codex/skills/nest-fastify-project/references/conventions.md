# Project Conventions

Use these rules for any code edit in `/home/phuth/Desktop/nest-fastify`.

## Stack

NestJS 11 + Fastify + Prisma 7 + nestjs-zod + Zod 4 + `@js-temporal/polyfill` + Biome 2.4.16 + Jest + pnpm.

The app is single-tenant. Do not introduce tenant/org partition concepts.

## Structure

- `src/common/`: cross-cutting decorators, filters, guards, interceptors, HTTP helpers.
- `src/core/`: infrastructure such as config, Prisma, queue, messaging, health, auth infrastructure.
- `src/modules/`: business features. Each feature owns `controllers/`, `decorators/`, `services/`, `dto/`, `repositories/`, and only feature-specific optional folders.
- CRUD resource modules normally use plural module paths/classes such as `src/modules/users/users.module.ts`, `users.controller.ts`, and `users.service.ts`.
- Repository ports, Prisma repository implementations, and DTO model files normally use the singular model name such as `user.repository.port.ts` and `user-response.dto.ts`.
- Do not create module barrel `index.ts` files.

## Imports

- Use path aliases for cross-module/layer imports: `@common/*`, `@core/*`, `@modules/*`, `@generated/*`.
- Use short relative imports inside the same module: `./`, `../dto/`, `../services/`.
- Do not use `../../../` for cross-module/layer imports.
- `import type` is not required by Biome, but it is acceptable when useful.

```ts
import { PrismaService } from '@core/prisma/prisma.service';
import type { User } from '@generated/prisma/client';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { UserRepository } from '../repositories/user.repository.port';
```

## TypeScript and Biome

- Production code in `src/` must not use TypeScript `any`, including `as any`.
- Test code can use `any` for test doubles when needed.
- `z.any()` is allowed because it is a Zod runtime API, not TypeScript `any`.
- When casting through another shape, use `unknown`: `value as unknown as T`.
- For untyped external APIs, define an explicit interface instead of casting to `any`.
- Use single quotes, semicolons, trailing commas, 2-space indent, and 100-char line width.
- Run `pnpm check` after formatting or safe auto-fixes.

## DTOs

- Use `nestjs-zod` and the exact double-cast pattern from `references/dto.md`.
- Use top-level `z.email()` for email fields.
- Do not use `class-validator`, property decorators such as `@IsString`, or `@ApiProperty` in DTOs.
- For response DTO `Date` fields, use the mandated `z.any().transform(...)` pattern with the explanatory comment.

## Auth

- Auth is opt-out. The global auth guard protects endpoints by default.
- Public endpoints use `@Public()` from `@common/decorators/public.decorator`.
- Protected controllers put `ApiBearerAuth()` inside the module's composite Swagger controller decorator, not directly on the controller.

## Swagger and HTTP Status

- Each controller has a `src/modules/<feature>/decorators/<feature>-api.decorator.ts`.
- Controllers must not import directly from `@nestjs/swagger`.
- Class-level decorator: `Api<Feature>Controller()` combines `ApiTags`, `ApiStandardErrorResponses`, and `ApiBearerAuth()` when required.
- Endpoint decorators combine `ApiEnvelopeResponse(...)` and route-specific metadata.
- Every HTTP route declares `@HttpCode(HttpStatus.X)` explicitly.
- The `HttpStatus.X` in `@HttpCode` must match the `status` in `ApiEnvelopeResponse`.
- Do not use magic status numbers.

## Repository Port Pattern

- Service injects the port abstract class: `<Feature>Repository`.
- Port file: `repositories/<feature>.repository.port.ts`.
- Prisma implementation file: `repositories/<feature>.repository.prisma.ts`.
- Port re-exports model type via `export type { Feature }` and defines create/update data types.
- Prisma implementation is the only feature file that imports `PrismaService` and generated Prisma model types.
- Module wiring uses `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`.
- Services import model types from the port, not from `@generated/prisma/client`.

## Prisma Errors and Transactions

- Handle `Prisma.PrismaClientKnownRequestError` in repository implementations when relevant.
- `P2002` maps to `ConflictException`.
- `P2025` maps to `NotFoundException`.
- `P2003` maps to `BadRequestException`.
- Multi-step DB writes belong in `prisma.$transaction`.
- Do not put external HTTP calls or queue operations inside a DB transaction.

## Date and Time

- Use `@js-temporal/polyfill` for date/time logic.
- Do not use `new Date()` for date logic.
- Prisma `DateTime` columns return JS `Date`; convert to Temporal only when computation is needed.

```ts
import { Temporal, toTemporalInstant } from '@js-temporal/polyfill';

const now = Temporal.Now.instant();
const today = Temporal.Now.plainDateISO();
const expiresAt = Temporal.Now.instant().add({ hours: 1 });
const instant = toTemporalInstant.call(someDate);
```

## Tests

- Unit specs live under `test/unit/`, mirroring `src/`.
- Do not colocate unit specs next to source files.
- Use plain object mocks with `useValue`.
- Mock repository ports in service tests, not `PrismaService`.
- Call `jest.clearAllMocks()` in `beforeEach`.
- Use behavior-style test names and specific assertions.

## Convention Scan Scopes

When asked to scan conventions, accept:

- Path: a specific file or directory.
- `all`: entire project, excluding `src/generated`.
- `--changed`: `.ts` files changed relative to detected base branch.
- `--dirty`: uncommitted plus untracked `.ts` files.
- `--staged`: staged `.ts` files.
- `--fix`: auto-fix only safe issues, then remind to run `pnpm check`.
- `--summary`: output only aggregate counts.

Detect base branch without hardcoding `main`:

```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

Always exclude `src/generated/`.

Report convention violations as:

```text
file:line - violation -> fix
```

For `--fix`, end with: `Remember to run pnpm check to format and lint the entire project.`

## Patterns That Do Not Belong

- TypeORM, `TypeOrmModule.forFeature`, `@InjectRepository`, entity classes for decorator-based ORM.
- Legacy date libraries such as Moment or Day.js.
- `class-validator` decorators.
- Multi-tenant/org architecture.
- Centralized constraint or error-message constants copied from older projects.
- `register-as` config factories from `@nestjs/config`.
- Hardcoded base branch names in diff ranges.
- Service-level direct `PrismaService` injection.
- Flat feature modules that skip `controllers/`, `services/`, `repositories/`, `dto/`.
