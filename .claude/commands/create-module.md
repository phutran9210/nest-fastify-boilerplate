# /create-module

Scaffold a complete feature module following this project's feature-first architecture (NestJS 11 + Fastify + Prisma 7 + nestjs-zod).

**Input:** `$ARGUMENTS` is the feature name (e.g.: `product`, `order`, `category`).

---

## Naming conventions

| Form           | Example (input: `product`)  |
|----------------|---------------------------|
| camelCase      | `product`                 |
| PascalCase     | `Product`                 |
| pluralCamel    | `products`                |
| pluralPascal   | `Products`                |
| kebab          | `product`                 |

If input is `product-category`, adjust accordingly: `productCategory`, `ProductCategory`, `product-categories`, etc.

---

## STEP 1 (mandatory) — Check Prisma model before generating code

This is the most important step, and even more so with the repository port architecture: file `<feature>.repository.prisma.ts` calls `this.prisma.<feature>` — if the model does not exist in the Prisma schema then the Prisma client has not generated that accessor and **the code will not compile**.

Follow this order:

1. Read the contents of `prisma/schema.prisma`.
2. Search for the model with the corresponding PascalCase name (e.g.: `Product`) in that file.
3. **If the model EXISTS:**
   - Continue to Step 2 (generate full CRUD with Prisma).
   - Note the model fields to infer DTOs (for use in Step 3).
4. **If the model DOES NOT EXIST:**
   - STOP, DO NOT generate service/repository code that calls Prisma (because the code will not compile).
   - Inform the user:
     > "Model `<Feature>` does not exist in `prisma/schema.prisma`. You need to add the model first then run `pnpm prisma:migrate && pnpm prisma:generate`."
   - Ask the user about the required fields, or request them to provide them.
   - Create a **model suggestion** for the user to paste into `schema.prisma` themselves (DO NOT overwrite this file directly).
   - Scaffold the module as a **TODO stub** (service methods return `throw new Error('TODO')`) so the build does not break.
   - Stop after completing the stub, remind the user to add the Prisma model before actual use.

> **Note:** This command MUST NOT overwrite `prisma/schema.prisma`.

---

## STEP 2 — Directory structure (feature-first, with subfolders)

Create the following files in `src/modules/<feature>/`:

```
src/modules/<feature>/
├── <feature>.module.ts
├── controllers/
│   └── <feature>.controller.ts
├── decorators/
│   └── <feature>-api.decorator.ts      # Centralized Swagger — composite @Api*()
├── services/
│   ├── <feature>.service.ts
│   └── <feature>.service.spec.ts
├── repositories/
│   ├── <feature>.repository.port.ts    # PORT — abstract class + re-export types
│   └── <feature>.repository.prisma.ts  # IMPL — the only file that imports PrismaService
└── dto/
    ├── create-<feature>.dto.ts
    ├── update-<feature>.dto.ts
    └── <feature>-response.dto.ts
```

**Do not create** `index.ts` files (barrel exports).

**Imports:** cross module/layer imports use path aliases (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`); within the same module use short relative paths (`./`, `../dto/`, `../services/`). DO NOT use `../../../`.

Specific reference: see `src/modules/users/` to understand the exact shape of each file.

---

## STEP 3 — Content of each file (using `Product` / `Products` / `product` as example)

### `repositories/product.repository.port.ts` — PORT

```ts
import type { Product } from '@generated/prisma/client';

// Re-export model shape via port → service/test depend on PORT, not importing generated/ directly.
export type { Product };

export type CreateProductData = {
  name: string;
  price: number;
  // add required fields from the Prisma model
};
export type UpdateProductData = Partial<CreateProductData>;

export abstract class ProductRepository {
  abstract findById(id: string): Promise<Product | null>;
  abstract findAll(): Promise<Product[]>;
  abstract create(data: CreateProductData): Promise<Product>;
  abstract update(id: string, data: UpdateProductData): Promise<Product>;
  abstract delete(id: string): Promise<Product>;
}
```

> The abstract class serves as both a **TS type** and a **DI token** — the module uses it as the `provide` key.

---

### `repositories/product.repository.prisma.ts` — IMPL

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@core/prisma/prisma.service';
import type { Product } from '@generated/prisma/client';
import { type CreateProductData, type UpdateProductData, ProductRepository } from './product.repository.port';

@Injectable()
export class PrismaProductRepository extends ProductRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findById(id: string): Promise<Product | null> {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findAll(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }

  create(data: CreateProductData): Promise<Product> {
    return this.prisma.product.create({ data });
  }

  update(id: string, data: UpdateProductData): Promise<Product> {
    return this.prisma.product.update({ where: { id }, data });
  }

  delete(id: string): Promise<Product> {
    return this.prisma.product.delete({ where: { id } });
  }
}
```

> This file is the **ONLY** one allowed to import `PrismaService` and `generated/prisma` within the entire feature module.

---

### `services/products.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateProductData,
  type UpdateProductData,
  type Product,
  ProductRepository,
} from '../repositories/product.repository.port';

@Injectable()
export class ProductsService {
  constructor(private readonly products: ProductRepository) {}

  create(data: CreateProductData): Promise<Product> {
    return this.products.create(data);
  }

  findAll(): Promise<Product[]> {
    return this.products.findAll();
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.products.findById(id);
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async update(id: string, data: UpdateProductData): Promise<Product> {
    await this.findOne(id);
    return this.products.update(id, data);
  }

  async remove(id: string): Promise<Product> {
    await this.findOne(id);
    return this.products.delete(id);
  }
}
```

> The service injects the PORT (`ProductRepository`), with no knowledge of Prisma. It imports the `Product` type from the PORT (not from `generated/`).

---

### `decorators/products-api.decorator.ts` — Centralized Swagger

**Mandatory rule:** all Swagger decorators live in this file as composite `applyDecorators`. The controller **does not** import directly from `@nestjs/swagger`.

- One class-level decorator: `Api<Feature>Controller()` — combines `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` if the route requires auth).
- One per-endpoint decorator: `Api<Action>()` — combines `ApiEnvelopeResponse(...)` (and any route-specific metadata).
- **`status` always uses `HttpStatus.X`** (from `@nestjs/common`), matching exactly the `@HttpCode` on the controller — no magic numbers.

```ts
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { ProductResponseDto } from '../dto/product-response.dto';

// Class-level: tag + standard error envelope + bearer token for all routes.
export function ApiProductsController() {
  return applyDecorators(ApiTags('products'), ApiStandardErrorResponses(), ApiBearerAuth());
}

// POST /products — create resource → 201 Created, envelope.
export function ApiCreateProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.CREATED }));
}

// GET /products — list → 200 OK (use `paginated: true` if this is a paginated route).
export function ApiListProducts() {
  return applyDecorators(
    ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK, paginated: true }),
  );
}

// GET /products/:id → 200 OK
export function ApiFindProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK }));
}

// PATCH /products/:id → 200 OK
export function ApiUpdateProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK }));
}

// DELETE /products/:id → 200 OK
export function ApiRemoveProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK }));
}
```

---

### `controllers/products.controller.ts`

```ts
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  ApiCreateProduct,
  ApiFindProduct,
  ApiListProducts,
  ApiProductsController,
  ApiRemoveProduct,
  ApiUpdateProduct,
} from '../decorators/products-api.decorator';
import { CreateProductDto } from '../dto/create-product.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
import { ProductResponseDto } from '../dto/product-response.dto';
import { ProductsService } from '../services/products.service';

@ApiProductsController()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(ProductResponseDto)
  @ApiCreateProduct()
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ProductResponseDto)
  @ApiListProducts()
  findAll() {
    return this.products.findAll();
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ProductResponseDto)
  @ApiFindProduct()
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ProductResponseDto)
  @ApiUpdateProduct()
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(ProductResponseDto)
  @ApiRemoveProduct()
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
```

Notes:
- `JwtAuthGuard` is registered globally (global guard), so there is no need to add `@UseGuards` here. The bearer requirement for Swagger lives in `ApiProductsController()` (via `ApiBearerAuth()`), not placed directly on the controller.
- **Every route declares `@HttpCode(HttpStatus.X)` explicitly**, using the same `HttpStatus.X` as the `status` in the Swagger decorator — runtime and docs always stay in sync.

---

### `products.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ProductsController } from './controllers/products.controller';
import { ProductRepository } from './repositories/product.repository.port';
import { PrismaProductRepository } from './repositories/product.repository.prisma';
import { ProductsService } from './services/products.service';

@Module({
  controllers: [ProductsController],
  providers: [
    ProductsService,
    { provide: ProductRepository, useClass: PrismaProductRepository },
  ],
  exports: [ProductsService],
})
export class ProductsModule {}
```

> `{ provide: ProductRepository, useClass: PrismaProductRepository }` is how NestJS DI knows "when someone injects the PORT (`ProductRepository`), provide the IMPL (`PrismaProductRepository`)".

---

### `dto/` — Three DTO files

Create three DTO files using the `/create-dto` command, passing in:
- The feature name
- The list of fields inferred from the Prisma model (or provided by the user if the model does not exist yet)

General structure:
- `create-<feature>.dto.ts` — uses `createZodDto(Schema)` for required fields.
- `update-<feature>.dto.ts` — uses `createZodDto(Schema.partial())` or extends the create schema.
- `<feature>-response.dto.ts` — includes all returned fields (including `id`, `createdAt`, `updatedAt`).

---

### `services/<feature>.service.spec.ts`

Create the spec file using the `/create-test` command, passing in the service path. Mock the **repository PORT** (not `PrismaService`):

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductRepository } from '../repositories/product.repository.port';
import { ProductsService } from './products.service';

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
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });

  it('create delegates to repository.create', async () => {
    const created = { id: '1', name: 'A', price: 10 };
    repo.create.mockResolvedValue(created);
    const result = await service.create({ name: 'A', price: 10 });
    expect(repo.create).toHaveBeenCalledWith({ name: 'A', price: 10 });
    expect(result).toBe(created);
  });
});
```

---

## STEP 4 — Register the module in `src/app.module.ts`

NestJS **does not auto-detect** modules. After creating all files, add the new module to `src/app.module.ts`:

1. Add the import statement at the top of the file:
   ```ts
   import { ProductsModule } from './modules/products/products.module';
   ```
2. Add `ProductsModule` to the `imports` array of `@Module(...)`.

Example (after editing):
```ts
@Module({
  imports: [
    // ... existing modules ...
    ProductsModule,
  ],
})
export class AppModule {}
```

**Do not skip this step** — without registration, the controller will not work.

---

## Post-creation checks

After all files are created, run the following command to confirm the build does not break:

```bash
pnpm build
```

If there are errors related to Prisma types (`Product`, `this.prisma.product`, ...):
- Has the model been added to `prisma/schema.prisma`?
- Has `pnpm prisma:migrate && pnpm prisma:generate` been run?

---

## Summary of what NOT to do

- DO NOT use TypeORM, `TypeOrmModule.forFeature`, `@InjectRepository`.
- DO NOT create `index.ts` barrel export files.
- DO NOT overwrite `prisma/schema.prisma`.
- DO NOT inject `PrismaService` into service — only inject via the repository PORT.
- DO NOT import `generated/prisma` from service — only `<feature>.repository.prisma.ts` is allowed to do so.
- DO NOT create a flat structure — always use `controllers/`, `services/`, `repositories/`, `dto/`.
