# DTO Workflow

Use this workflow when creating or reviewing DTOs.

## Syntax Model

The original Claude command was:

```text
/create-dto <FeatureName> <kind> [field:type ...]
```

Supported kinds:

- `create`
- `update`
- `response`
- `query`

## Field Source Priority

Follow this order exactly:

1. If `prisma/schema.prisma` has model `<Feature>` in PascalCase, infer fields from the model.
2. If no Prisma model exists and the user provided explicit `field:type` pairs, use exactly those fields.
3. If neither exists, stop and ask the user for fields and types before writing files. Do not guess.

For Prisma model inference:

- `response`: include all non-sensitive fields. Exclude `password`, `passwordHash`, `secret`, `token`, and similar secrets.
- `create`: include required input fields. Exclude `id`, `createdAt`, `updatedAt`, and auto-generated fields.
- `update`: use `.partial()` from the create schema.
- `query`: use the standard pagination template.

## File Locations

Write DTOs to:

```text
src/modules/<feature>/dto/<kind>-<feature>.dto.ts
```

Response DTOs use:

```text
src/modules/<feature>/dto/<feature>-response.dto.ts
```

Examples for `Product`:

- `src/modules/product/dto/create-product.dto.ts`
- `src/modules/product/dto/update-product.dto.ts`
- `src/modules/product/dto/product-response.dto.ts`
- `src/modules/product/dto/product-query.dto.ts`

## Required createZodDto Pattern

Do not simplify this pattern. The double cast is required for generic type inference.

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createProductSchema = z.object({
  name: z.string().min(1),
  price: z.number().int().nonnegative(),
});

export class CreateProductDto extends (createZodDto(createProductSchema) as ReturnType<
  typeof createZodDto<typeof createProductSchema>
>) {}
```

Wrong:

```ts
export class CreateProductDto extends createZodDto(createProductSchema) {}
```

## Update DTO Template

```ts
import { createZodDto } from 'nestjs-zod';
import { createProductSchema } from './create-product.dto';

export const updateProductSchema = createProductSchema.partial();

export class UpdateProductDto extends (createZodDto(updateProductSchema) as ReturnType<
  typeof createZodDto<typeof updateProductSchema>
>) {}
```

## Response DTO Template

Keep the `Date` comment as-is when any response field uses the Date transform.

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Dates use `z.any().transform(...)` (Date -> ISO string) on purpose: `z.date()` is not
// representable by Zod v4's `z.toJSONSchema()`, which nestjs-zod calls to build the Swagger
// doc - using `z.date()` here (even inside a union) crashes app bootstrap. Do not "simplify".
export const productResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  price: z.number(),
  createdAt: z.any().transform((v: unknown) => (v instanceof Date ? v.toISOString() : String(v))),
  updatedAt: z.any().transform((v: unknown) => (v instanceof Date ? v.toISOString() : String(v))),
});

export class ProductResponseDto extends (createZodDto(productResponseSchema) as ReturnType<
  typeof createZodDto<typeof productResponseSchema>
>) {}
```

Do not use `z.date()` in response DTOs because Zod v4 JSON schema generation can crash during Swagger bootstrap.

## Query DTO Template

Query numbers come from strings. Use `z.coerce.number()`.

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const productQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

export class ProductQueryDto extends (createZodDto(productQuerySchema) as ReturnType<
  typeof createZodDto<typeof productQuerySchema>
>) {}
```

## Zod 4 Idioms

- Email: `z.email()`, not `z.string().email()`.
- ISO date-time input: `z.iso.datetime()`.
- Update DTO: `.partial()`.
- Query param numbers: `z.coerce.number()`.
- Enum: `z.enum(['A', 'B'])`.
- Optional field: `.optional()` or `.nullable()`.
- Response Date: `z.any().transform(...)` with the required comment.

## Forbidden DTO Patterns

- `class-validator` imports.
- Decorators such as `@IsString`, `@IsEmail`, `@MaxLength`, `@IsOptional`.
- `@ApiProperty` or `ApiPropertyOptional` in DTOs.
- Centralized `CONSTRAINTS` copied from older projects.
- Validation decorators other than Zod.

## Execution Checklist

1. Parse feature name and kind.
2. Determine field source by the priority order above.
3. Ask the user for fields only if there is no Prisma model and no explicit fields.
4. Apply the matching template.
5. Write the file under `src/modules/<feature>/dto/`.
6. Run relevant tests/checks when practical.
