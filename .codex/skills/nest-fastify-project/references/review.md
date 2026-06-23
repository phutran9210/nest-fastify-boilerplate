# Code Review Workflow

Use this for explicit code review, convention checks, or review-like requests.

## Scope Arguments

Accept:

- Specific path.
- `all`: all source files.
- `--changed`: files changed compared to base branch.
- `--dirty`: uncommitted plus untracked files.
- `--staged`: staged files.
- `--fix`: automatically fix safe issues, then run `pnpm check`.
- `--summary`: only print summary.

Determine base branch without hardcoding:

```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

Only review `.ts` files unless the user asks otherwise.
Always exclude `src/generated/`.

## Review Mindset

Prioritize bugs, risks, behavioral regressions, security issues, data loss, and missing tests.

Findings come first, ordered by severity, with file and line references.

If no findings are found, state that explicitly and mention residual risks or testing gaps.

## Criteria

### 1. Correctness

Check:

- Logic matches intent.
- Conditions are not inverted.
- `null` from `findUnique` is handled before use.
- Empty arrays do not crash code.
- Pagination uses `skip = (page - 1) * limit`.
- Promises are awaited where needed.

### 2. Security

Check:

- Auth is opt-out through the global guard.
- `@Public()` appears only on genuinely public endpoints.
- Sensitive output fields are stripped by `@ZodSerializerDto(<Feature>ResponseDto)`.
- Prisma `select` is recommended defense-in-depth but not mandatory if response DTO filtering is correct.
- No hardcoded secrets.

### 3. Error Handling

Check:

- Services throw NestJS exceptions such as `NotFoundException`, `BadRequestException`, `ConflictException`.
- Controllers do not swallow errors with broad try/catch.
- Prisma `P2002`, `P2025`, and `P2003` are classified correctly where applicable.

### 4. Data Integrity

Check:

- Multi-step writes use `prisma.$transaction`.
- Unique constraints are enforced by Prisma schema/DB when needed.
- No intermediate state remains if later steps fail.

### 5. Performance

Check:

- No N+1 query loops.
- List endpoints have pagination.
- Code does not fetch entire large tables into memory.

### 6. Prisma and Query Quality

Check:

- Transaction scope contains only DB work.
- No external HTTP calls or queue operations inside a transaction.
- Missing `select` is not a failure when DTO serialization correctly strips fields.

### 7. API Design

Check:

- REST status conventions are followed.
- Controllers do not import directly from `@nestjs/swagger`.
- Swagger metadata lives in `<module>/decorators/<feature>-api.decorator.ts`.
- Every route has explicit `@HttpCode(HttpStatus.X)`.
- Runtime status and Swagger envelope status match.
- Controllers use response DTO serialization.

### 8. Readability

Check:

- Names are clear.
- Functions stay focused.
- Magic numbers have names where needed.
- No dead code or unused imports.

### 9. Testing

Check:

- Unit specs live under `test/unit/`, mirroring `src/`.
- Mocks use plain objects with `useValue`.
- `jest.clearAllMocks()` appears in `beforeEach`.
- Assertions are specific.
- Test names describe behavior.
- Service tests mock repository ports, not Prisma.

### 10. Architecture and Layering

Check:

- `common/` vs `core/` responsibility boundaries.
- Services do not call `this.prisma.*`.
- Services and controllers do not import generated Prisma model types directly.
- Only `<feature>.repository.prisma.ts` imports `PrismaService` in a feature.
- Repository port and implementation use suffix naming.
- Module wiring has `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`.
- Services inject ports, not implementations.
- Feature directories use the expected subfolders.

### 11. Project Conventions

Check:

- `pnpm check` or `pnpm lint` was run when relevant.
- Import aliases are correct.
- Production `src/` code contains no TypeScript `any` or `as any`.
- `z.any()` in DTO Date transforms is not a TypeScript `any` violation.

## Result Format

For full reviews:

```text
### 1. Correctness - PASS | WARN | FAIL
- path/to/file.ts:42 - issue -> fix

### 2. Security - PASS | WARN | FAIL
- path/to/file.ts:99 - issue -> fix
```

Summary:

```text
CRITICAL: X issues
HIGH:     X issues
MEDIUM:   X issues
LOW:      X issues

TOP 3 priorities:
1. [CRITICAL/HIGH] file:line - short description
2. ...
3. ...
```

Severity:

- CRITICAL: security vulnerability, potential data loss, unhandled crash.
- HIGH: incorrect logic, improperly caught errors, severe N+1.
- MEDIUM: missing validation, missing Swagger, missing test coverage.
- LOW: readability, minor conventions.

For simple code review responses, follow Codex review style: findings first, concise open questions or residual risks after.

## Fix Mode

With `--fix`, fix only safe issues such as formatting, unused imports, or clearly mechanical Swagger/convention adjustments.

Then run:

```bash
pnpm check
```

Report what was fixed and any remaining manual issues.
