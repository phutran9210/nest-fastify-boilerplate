# Lệnh /create-dto — Tạo DTO cho nestjs-zod

## Cú pháp

```
/create-dto <FeatureName> <kind> [field:type ...]
```

- `<FeatureName>`: Tên feature theo PascalCase (ví dụ: `Product`, `User`, `Order`)
- `<kind>`: Loại DTO — một trong các giá trị: `create` | `update` | `response` | `query`
- `[field:type ...]`: (Tuỳ chọn) Danh sách trường nếu không có model Prisma

Ví dụ:
```
/create-dto Product create
/create-dto Order response
/create-dto Invoice query
/create-dto Tag create name:string color:string
```

---

## Nguồn trường — Thứ tự ưu tiên (PHẢI tuân thủ theo thứ tự này)

1. **Prisma schema** — Nếu tồn tại model `<Feature>` (PascalCase) trong `prisma/schema.prisma`, hãy đọc và suy ra các trường từ model đó (tên, kiểu, nullable, `@unique`):
   - `response`: dùng tất cả các trường **không nhạy cảm** (loại bỏ `password` và bất kỳ trường nào có thể là bí mật như `passwordHash`, `secret`, `token`).
   - `create`: dùng các trường bắt buộc đầu vào (bỏ `id`, `createdAt`, `updatedAt` và các trường tự động).
   - `update`: `.partial()` của schema create.
   - `query`: luôn dùng mẫu phân trang chuẩn (xem template bên dưới).

2. **Trường trong `$ARGUMENTS`** — Nếu không có model Prisma nhưng `$ARGUMENTS` cung cấp danh sách trường rõ ràng → dùng đúng những trường đó.

3. **Hỏi người dùng** — Nếu không có model Prisma VÀ không có trường trong `$ARGUMENTS` → **DỪNG LẠI và hỏi người dùng** danh sách trường cùng kiểu dữ liệu trước khi viết bất kỳ file nào. **Không được tự đoán.**

---

## Vị trí file đầu ra

```
src/modules/<feature>/dto/<kind>-<feature>.dto.ts
```

Ví dụ với `Product`:
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

## Template — Update DTO (partial của create)

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

> **Lưu ý quan trọng về Date:** Comment trên là **BẮT BUỘC** và phải giữ nguyên. Không được dùng `z.date()` trực tiếp vì `z.toJSONSchema()` của Zod v4 (được nestjs-zod gọi để tạo tài liệu Swagger) không hỗ trợ `z.date()` — app sẽ crash khi khởi động. Luôn dùng `z.any().transform(...)`.

---

## Template — Query DTO (phân trang, coerce số từ query string)

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

## Các idiom Zod 4 cần dùng

| Mục đích | Cú pháp đúng (Zod 4) |
|---|---|
| Email | `z.email()` — **top-level**, KHÔNG dùng `z.string().email()` |
| ISO date-time (đầu vào) | `z.iso.datetime()` |
| Update DTO | `.partial()` |
| Query params (số) | `z.coerce.number()` |
| Enum | `z.enum(['A', 'B'])` |
| Optional field | `.optional()` hoặc `.nullable()` |
| Date trong response | `z.any().transform(...)` (xem lưu ý trên) |

---

## TUYỆT ĐỐI KHÔNG dùng (thuộc về project cũ / cách tiếp cận khác)

Dự án này **chỉ dùng Zod**. Các thành phần sau **không được xuất hiện** trong bất kỳ DTO nào:

- Thư viện `class-validator` (bất kỳ import nào từ package này)
- Decorator field như `@IsString`, `@IsEmail`, `@MaxLength`, `@IsOptional`, v.v.
- Decorator Swagger như `@ApiProperty(` hoặc `ApiPropertyOptional`
- Hằng số `CONSTRAINTS`
- Bất kỳ decorator validation nào khác ngoài Zod

---

## Quy trình thực hiện

1. Đọc `$ARGUMENTS` để xác định `<FeatureName>` và `<kind>`.
2. Xác định nguồn trường theo **thứ tự ưu tiên** ở trên.
3. Nếu cần hỏi người dùng (trường hợp 3) → hỏi trước, không viết code.
4. Áp dụng template phù hợp, thay `Product`/`product` bằng tên feature thực tế.
5. Viết file vào đúng đường dẫn `src/modules/<feature>/dto/`.
6. Hiển thị nội dung file đã tạo để người dùng review.
