# /create-test — Create Jest unit test for a service or controller

Read the source file at `$ARGUMENTS`, then create a spec file in the `test/unit/` tree (mirroring the `src/` structure).

## File placement rules

Tests are NOT colocated. Spec files live in `test/unit/` following the exact mirror path of `src/`. For example:

- Source: `src/modules/users/services/users.service.ts`
- Test:   `test/unit/modules/users/services/users.service.spec.ts`

DO NOT place tests in `__tests__/` and DO NOT place them next to the source file.

**Imports of source files in tests always use path aliases** (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`) — DO NOT use relative `./` or `../` to point back to `src/`. For example: `import { UsersService } from '@modules/users/services/users.service'`.

## Test module structure

Use `Test.createTestingModule` with all dependencies mocked as **plain objects** via `useValue`. DO NOT use `jest.mock(...)` directly to mock modules, DO NOT use `createMock<...>()`, DO NOT use `getRepositoryToken`, DO NOT use `@InjectRepository` (that is a TypeORM pattern, not used in this project).

### Full example — service using a repository port

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
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
      providers: [
        ProductsService,
        { provide: ProductRepository, useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  it('findOne throws NotFoundException when the product does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
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

> The mock targets the **repository PORT** (`ProductRepository`), not `PrismaService`. The service knows nothing about Prisma.

### Mocking dependency services (not repositories)

If a service injects another service (e.g. `UsersService`), create a plain object in the same way:

```ts
const users = { findByEmail: jest.fn(), create: jest.fn() };
// Then pass it into providers:
{ provide: UsersService, useValue: users }
```

## Test writing rules

- `beforeEach` always calls `jest.clearAllMocks()` before compiling the module.
- Test names describe **behavior** in natural language, for example:
  - `'findOne throws NotFoundException when the user does not exist'`
  - `'create delegates to repository.create and returns the new user'`
  - A rigid `should ... when ...` template is NOT required.
  - DO NOT add `// Arrange / // Act / // Assert` comments.
- Assertions must be **specific**:
  - `toHaveBeenCalledWith(...)` — verify the exact arguments
  - `toBe(...)` / `toEqual(...)` — verify the return value
  - `rejects.toBeInstanceOf(NotFoundException)` or `rejects.toMatchObject({ status: 404 })` — verify exceptions

## Steps to follow

1. Read the file at `$ARGUMENTS` to understand the class, constructor dependencies, and public methods.
2. Determine the spec file path: take the source path under `src/`, replace the `src/` prefix with `test/unit/`, and change `.ts` to `.spec.ts`. E.g. `src/modules/users/services/users.service.ts` → `test/unit/modules/users/services/users.service.spec.ts`. Create the parent directory if it does not exist.
3. Create a mock object for each dependency:
   - If the service injects a repository PORT (abstract class) → mock that PORT with a plain object.
   - If the service injects another service → mock that service with a plain object.
4. Write at least one test case for each public method of the class:
   - Happy path (returns the correct data).
   - Error/edge case if the method handles errors (e.g. not found, validation failure).
5. Only import what is actually used.
6. Do not create any files other than the spec file.

## Running tests

```bash
# Run all tests
pnpm test

# Run only the newly created file
pnpm test test/unit/modules/users/services/users.service.spec.ts
```
