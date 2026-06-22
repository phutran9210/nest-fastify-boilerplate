# /create-tdd — TDD Red-Green-Refactor Workflow

Use this command to develop features or fix bugs following the TDD (Test-Driven Development) workflow for the NestJS 11 + Prisma 7 + nestjs-zod + Jest + Biome + pnpm project.

**Input:** $ARGUMENTS — short description of the feature/bug to address, or path to the related file/module.

---

## Step 1 — Red: Write a failing test first

Write the test BEFORE any implementation code exists. Follow the conventions from the `/create-test` command:

- Test files go in `test/unit/` (mirroring the `src/` structure), named `*.spec.ts` — NOT colocated. Import source using path aliases (`@modules/*`, `@common/*`…)
- Mock with plain object `useValue`, DO NOT use `jest.fn()` as a direct value
- Call `jest.clearAllMocks()` in `beforeEach`
- Test names should describe behavior (behavior-style), e.g.: `it('should throw NotFoundException when user not found', ...)`
- Use specific assertions, verify actual results (not just that mocks were called)

**DO NOT write any implementation code in this step.**

Example test structure:

```typescript
describe('UserService', () => {
  let service: UserService;
  let prisma: { user: { findUnique: jest.Mock } };

  beforeEach(async () => {
    prisma = { user: { findUnique: jest.fn() } };

    const module = await Test.createTestingModule({
      providers: [
        UserService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(UserService);
    jest.clearAllMocks();
  });

  it('should throw NotFoundException when user not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findOne(999)).rejects.toThrow(NotFoundException);
  });
});
```

---

## Step 2 — Confirm the test FAILS

Run the test and verify it FAILS for the right reason:

```bash
pnpm test <path-to-spec-file>
# Or run all:
pnpm test
```

**Verify:**
- The test must fail (red) — if the test passes immediately, it means the test is not actually checking anything, go back to Step 1.
- The test must fail for the RIGHT REASON, e.g.: `Cannot find module`, `... is not a function`, or assertion failure because there is no implementation yet.
- If the test fails due to import errors or syntax errors, FIX THE TEST FIRST — do not move to the next step while the test fails for the wrong reason.

---

## Step 3 — Green: Write minimal implementation

Write just enough code to make the test pass. Follow the conventions from the `/coding-convention` command:

- Access the database through `PrismaService`, do not call Prisma directly
- `NotFoundException` uses template literal: `` throw new NotFoundException(`User ${id} not found`) ``
- DTOs use `nestjs-zod` (`createZodDto`)
- Date/time logic uses `Temporal` (not `Date`, `dayjs`, `moment`)
- Relative imports (relative), do not use absolute aliases except `@prisma/client`
- Flat structure within modules (avoid deeply nested directories)

**YAGNI:** Only write what is necessary to make the test pass. Do not add features that have no test.

After writing, run again:

```bash
pnpm test <path-to-spec-file>
```

The test must PASS (green). If it still fails, keep fixing the implementation (not the test) until it passes.

---

## Step 4 — Refactor: Clean up with green tests

Once the test passes, refactor the code to improve quality without changing behavior:

- Use clearer variable/function names
- Remove duplicate code (DRY)
- Extract complex logic into separate functions if needed
- Keep all tests green after every change

After each refactoring change, run the test again:

```bash
pnpm test <path-to-spec-file>
```

**Do not refactor until tests are green. Do not change behavior when refactoring.**

---

## Step 5 — Finalize: Run full checks and commit

### Run all tests:

```bash
pnpm test
```

All tests must pass (no failures).

### Run Biome format and lint:

```bash
pnpm check
```

Fix all lint and format errors before committing.

### Commit:

Commit in small red-green-refactor cycles. Ideally each commit corresponds to one behavior that has been tested and implemented:

```bash
git add <related-files>
git commit -m "feat(<module>): <behavior-description>"
```

---

## Key principles to remember

| Principle | Details |
|---|---|
| Test first, code after | NEVER write implementation before having a failing test |
| One behavior at a time | Each TDD cycle handles only one case/behavior |
| Test must fail first | Test passing immediately = test is not actually checking anything |
| Small commits | Ideally one commit per red-green-refactor cycle |
| Reference other commands | Use `/create-test` for test conventions, `/coding-convention` for code conventions |

---

## Quick reference

- Test conventions: `/create-test`
- Code conventions: `/coding-convention`
- Run tests: `pnpm test [path]`
- Check lint/format: `pnpm check`
