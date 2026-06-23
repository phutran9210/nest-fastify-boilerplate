# Testing and TDD

Use this for unit test creation and TDD work.

## Unit Test Placement

Unit specs live in `test/unit/`, mirroring `src/`.

Examples:

- Source: `src/modules/users/services/users.service.ts`
- Test: `test/unit/modules/users/services/users.service.spec.ts`

Do not place unit tests in `__tests__/`.
Do not colocate unit tests next to source files.

Imports of source files in tests use aliases:

```ts
import { UsersService } from '@modules/users/services/users.service';
```

Do not use relative imports pointing back to `src/`.

## Test Module Structure

- Use `Test.createTestingModule`.
- Mock dependencies with plain objects passed via `useValue`.
- Do not use module-level `jest.mock(...)` unless there is a specific unavoidable reason.
- Do not use `createMock<...>()`.
- Do not use `getRepositoryToken` or `@InjectRepository`; this project does not use TypeORM.
- If a service injects a repository port, mock the port abstract class.
- If a service injects another service, mock that service with a plain object.

## Service Test Example

```ts
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ProductRepository } from '@modules/products/repositories/product.repository.port';
import { ProductsService } from '@modules/products/services/products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const repo = {
    findById: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ProductsService, { provide: ProductRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  it('findOne throws NotFoundException when the product does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });

  it('create delegates to repository.create and returns the new product', async () => {
    const created = { id: '1', name: 'A', price: 10 };
    repo.create.mockResolvedValue(created);
    const result = await service.create({ name: 'A', price: 10 });
    expect(repo.create).toHaveBeenCalledWith({ name: 'A', price: 10 });
    expect(result).toBe(created);
  });
});
```

## Test Writing Rules

- `beforeEach` calls `jest.clearAllMocks()` before compiling the module.
- Test names describe behavior in natural language.
- Do not add boilerplate `Arrange / Act / Assert` comments.
- Use exact assertions: `toHaveBeenCalledWith`, `toBe`, `toEqual`.
- For errors, use `rejects.toBeInstanceOf(...)` or `rejects.toMatchObject({ status: 404 })`.
- Cover at least one happy path for each public method.
- Cover error/edge cases when the method handles them.
- Import only what is used.
- Do not create files other than the requested spec unless the user asked for broader changes.

## Create-Test Workflow

1. Read the source file to understand the class, constructor dependencies, and public methods.
2. Determine spec path by replacing `src/` with `test/unit/` and `.ts` with `.spec.ts`.
3. Create parent directory if missing.
4. Create plain object mocks for every dependency.
5. Use repository ports rather than Prisma in service tests.
6. Write specific behavior tests.
7. Run `pnpm test <spec-path>` when practical.

## TDD Workflow

### Red

Write the test before implementation code.

Follow the unit test rules above.

Do not write implementation code in the Red step.

### Confirm Red

Run:

```bash
pnpm test <path-to-spec-file>
```

Verify the test fails for the right reason.

If it passes immediately, the test is not checking the intended behavior. Strengthen the test before implementation.

If it fails due to import/syntax/setup mistakes, fix the test first.

### Green

Write only enough implementation to pass the failing test.

Respect repository ports, DTO rules, Temporal date logic, import rules, and project conventions.

Run the focused test again until it passes:

```bash
pnpm test <path-to-spec-file>
```

### Refactor

Only refactor after the test is green.

Keep behavior unchanged.

Run the focused test after each meaningful refactor.

### Finalize

Run:

```bash
pnpm test
pnpm check
```

Do not commit unless the user asks.
