# Command /create-dto — Create DTO for nestjs-zod

## Syntax

```
/create-dto <FeatureName> <kind> [field:type ...]
```

- `<FeatureName>`: Feature name in PascalCase (e.g.: `Product`, `User`, `Order`)
- `<kind>`: DTO type — one of: `create` | `update` | `response` | `query`
- `[field:type ...]`: (Optional) List of fields if there is no Prisma model

Examples:
```
/create-dto Product create
/create-dto Order response
/create-dto Invoice query
/create-dto Tag create name:string color:string
```

---

## Field source — Priority order (MUST follow this order)

1. **Prisma schema** — If a model `<Feature>` (PascalCase) exists in `prisma/schema.prisma`, read and infer fields from that model (name, type, nullable, `@unique`):
   - `response`: use all **non-sensitive** fields (exclude `password` and any fields that could be secrets such as `passwordHash`, `secret`, `token`).
   - `create`: use required input fields (exclude `id`, `createdAt`, `updatedAt` and auto-generated fields).
   - `update`: `.partial()` of the create schema.
   - `query`: always use the standard pagination template (see template below).

2. **Fields in `$ARGUMENTS`** — If there is no Prisma model but `$ARGUMENTS` provides an explicit field list → use exactly those fields.

3. **Ask the user** — If there is no Prisma model AND no fields in `$ARGUMENTS` → **STOP and ask the user** for the field list along with data types before writing any file. **Do NOT guess.**

---

## Output file location

```
src/modules/<feature>/dto/<kind>-<feature>.dto.ts
```

Example with `Product`:
- `src/modules/product/dto/create-product.dto.ts`
- `src/modules/product/dto/update-product.dto.ts`
- `src/modules/product/dto/product-response.dto.ts`
- `src/modules/product/dto/product-query.dto.ts`

---

## Template — Create DTO

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

---

## Template — Update DTO (partial of create)

```ts
import { createZodDto } from 'nestjs-zod';
import { createProductSchema } from './create-product.dto';

export const updateProductSchema = createProductSchema.partial();

export class UpdateProductDto extends (createZodDto(updateProductSchema) as ReturnType<
  typeof createZodDto<typeof updateProductSchema>
>) {}
```

---

## Template — Response DTO

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Dates use `z.any().transform(...)` (Date -> ISO string) on purpose: `z.date()` is not
// representable by Zod v4's `z.toJSONSchema()`, which nestjs-zod calls to build the Swagger
// doc — using `z.date()` here (even inside a union) crashes app bootstrap. Do not "simplify".
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

> **Important note about Date:** The comment above is **MANDATORY** and must be kept as-is. Do NOT use `z.date()` directly because Zod v4's `z.toJSONSchema()` (called by nestjs-zod to generate Swagger docs) does not support `z.date()` — the app will crash on startup. Always use `z.any().transform(...)`.

---

## Template — Query DTO (pagination, coerce numbers from query string)

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

---

## Zod 4 idioms to use

| Purpose | Correct syntax (Zod 4) |
|---|---|
| Email | `z.email()` — **top-level**, do NOT use `z.string().email()` |
| ISO date-time (input) | `z.iso.datetime()` |
| Update DTO | `.partial()` |
| Query params (numbers) | `z.coerce.number()` |
| Enum | `z.enum(['A', 'B'])` |
| Optional field | `.optional()` or `.nullable()` |
| Date in response | `z.any().transform(...)` (see note above) |

---

## ABSOLUTELY DO NOT use (belongs to old project / different approach)

This project **uses Zod only**. The following components **must NOT appear** in any DTO:

- The `class-validator` library (any import from this package)
- Field decorators like `@IsString`, `@IsEmail`, `@MaxLength`, `@IsOptional`, etc.
- Swagger decorators like `@ApiProperty(` or `ApiPropertyOptional`
- `CONSTRAINTS` constants
- Any validation decorators other than Zod

---

## Execution procedure

1. Read `$ARGUMENTS` to determine `<FeatureName>` and `<kind>`.
2. Determine the field source according to the **priority order** above.
3. If the user needs to be asked (case 3) → ask first, do not write code.
4. Apply the appropriate template, replacing `Product`/`product` with the actual feature name.
5. Write the file to the correct path `src/modules/<feature>/dto/`.
6. Display the generated file content for the user to review.
