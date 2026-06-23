# Feature Module Scaffold

Use this when creating a complete feature module.

## Input and Naming

Input is a feature name such as `product`, `order`, or `product-category`.

For `product`:

- camelCase: `product`
- PascalCase: `Product`
- pluralCamel: `products`
- pluralPascal: `Products`
- kebab: `product`

For compound names, preserve the same forms: `product-category`, `productCategory`, `ProductCategory`, `product-categories`.

For CRUD resource modules, follow the existing `users` shape: module path, module file, controller, service, and Swagger decorator use plural resource names; repository ports, Prisma implementations, and DTO model files use the singular model name.

## Step 1: Check Prisma Model First

Read `prisma/schema.prisma` before generating implementation code.

Search for `model <Feature>` using the PascalCase name.

If the model exists:

- Generate full CRUD with Prisma repository implementation.
- Infer DTO fields from the model.

If the model does not exist:

- Do not generate code that calls `this.prisma.<feature>`.
- Do not overwrite `prisma/schema.prisma`.
- Tell the user: `Model <Feature> does not exist in prisma/schema.prisma. You need to add the model first then run pnpm prisma:migrate && pnpm prisma:generate.`
- Ask for required fields if needed.
- Provide a Prisma model suggestion for the user to paste manually.
- Scaffold a TODO stub whose service methods throw `new Error('TODO')` so the build does not call a missing Prisma accessor.
- Remind the user to add the Prisma model before actual use.

## Directory Structure

Create:

```text
src/modules/<plural-feature>/
|-- <plural-feature>.module.ts
|-- controllers/
|   `-- <plural-feature>.controller.ts
|-- decorators/
|   `-- <plural-feature>-api.decorator.ts
|-- services/
|   `-- <plural-feature>.service.ts
|-- repositories/
|   |-- <feature>.repository.port.ts
|   `-- <feature>.repository.prisma.ts
`-- dto/
    |-- create-<feature>.dto.ts
    |-- update-<feature>.dto.ts
    `-- <feature>-response.dto.ts
```

Unit tests go under `test/unit/modules/<plural-feature>/...`, not inside `src/`.

Do not create `index.ts` barrel files.

## Repository Port

```ts
import type { Product } from '@generated/prisma/client';

export type { Product };

export type CreateProductData = {
  name: string;
  price: number;
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

The abstract class is both the TS type and Nest DI token.

## Prisma Repository Implementation

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '@core/prisma/prisma.service';
import type { Product } from '@generated/prisma/client';
import {
  type CreateProductData,
  ProductRepository,
  type UpdateProductData,
} from './product.repository.port';

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

This is the only feature file that imports `PrismaService` and generated Prisma model types.

## Service

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateProductData,
  type Product,
  ProductRepository,
  type UpdateProductData,
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

Services import the model type from the port, not from generated Prisma.

## Swagger Decorators

```ts
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { ProductResponseDto } from '../dto/product-response.dto';

export function ApiProductsController() {
  return applyDecorators(ApiTags('products'), ApiStandardErrorResponses(), ApiBearerAuth());
}

export function ApiCreateProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.CREATED }));
}

export function ApiListProducts() {
  return applyDecorators(
    ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK, paginated: true }),
  );
}

export function ApiFindProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK }));
}

export function ApiUpdateProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK }));
}

export function ApiRemoveProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.OK }));
}
```

## Controller

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
import { ProductResponseDto } from '../dto/product-response.dto';
import { UpdateProductDto } from '../dto/update-product.dto';
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

No `@UseGuards` is needed for normal protected controllers because the auth guard is global.

## Module

```ts
import { Module } from '@nestjs/common';
import { ProductsController } from './controllers/products.controller';
import { ProductRepository } from './repositories/product.repository.port';
import { PrismaProductRepository } from './repositories/product.repository.prisma';
import { ProductsService } from './services/products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, { provide: ProductRepository, useClass: PrismaProductRepository }],
  exports: [ProductsService],
})
export class ProductsModule {}
```

## App Module Registration

Nest does not auto-detect modules. Add the new module to `src/app.module.ts`:

```ts
import { ProductsModule } from './modules/products/products.module';
```

Then include `ProductsModule` in the `imports` array.

## Post-Creation Checks

Run:

```bash
pnpm build
```

If Prisma type/accessor errors appear, verify that the model exists and that `pnpm prisma:migrate && pnpm prisma:generate` has been run.

## Do Not

- Do not use TypeORM.
- Do not create barrel exports.
- Do not overwrite `prisma/schema.prisma`.
- Do not inject `PrismaService` into services.
- Do not import generated Prisma types from services.
- Do not create flat feature modules.
