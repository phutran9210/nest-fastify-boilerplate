# /create-module

Scaffold một feature module đầy đủ theo kiến trúc feature-first của dự án này (NestJS 11 + Fastify + Prisma 7 + nestjs-zod).

**Đầu vào:** `$ARGUMENTS` là tên tính năng (ví dụ: `product`, `order`, `category`).

---

## Quy tắc đặt tên

| Dạng           | Ví dụ (input: `product`)  |
|----------------|---------------------------|
| camelCase      | `product`                 |
| PascalCase     | `Product`                 |
| pluralCamel    | `products`                |
| pluralPascal   | `Products`                |
| kebab          | `product`                 |

Nếu input là `product-category`, điều chỉnh tương ứng: `productCategory`, `ProductCategory`, `product-categories`, v.v.

---

## BƯỚC 1 (bắt buộc) — Kiểm tra model Prisma trước khi tạo code

Đây là bước quan trọng nhất, và càng quan trọng hơn với kiến trúc repository port: file `<feature>.repository.prisma.ts` gọi `this.prisma.<feature>` — nếu model chưa có trong Prisma schema thì Prisma client chưa tạo ra accessor đó và **code sẽ không biên dịch được**.

Thực hiện theo thứ tự sau:

1. Đọc nội dung file `prisma/schema.prisma`.
2. Tìm kiếm model có tên PascalCase tương ứng (ví dụ: `Product`) trong file đó.
3. **Nếu model TỒN TẠI:**
   - Tiếp tục sang Bước 2 (tạo đầy đủ CRUD có Prisma).
   - Ghi nhớ các trường của model để suy ra DTO (để sử dụng ở Bước 3).
4. **Nếu model KHÔNG TỒN TẠI:**
   - DỪNG lại, KHÔNG tạo service/repository có gọi Prisma (vì code sẽ không biên dịch được).
   - Thông báo cho người dùng:
     > "Model `<Feature>` chưa tồn tại trong `prisma/schema.prisma`. Bạn cần thêm model trước rồi chạy `pnpm prisma:migrate && pnpm prisma:generate`."
   - Hỏi người dùng về các trường cần thiết, hoặc yêu cầu họ cung cấp.
   - Tạo một **gợi ý model** để người dùng tự dán vào `schema.prisma` (KHÔNG tự ghi đè lên file này).
   - Scaffold module ở dạng **TODO stub** (các phương thức service trả về `throw new Error('TODO')`) để build không bị lỗi.
   - Dừng lại sau khi hoàn thành stub, nhắc người dùng bổ sung Prisma trước khi dùng thật.

> **Lưu ý:** Lệnh này KHÔNG được tự ghi đè `prisma/schema.prisma`.

---

## BƯỚC 2 — Cấu trúc thư mục (feature-first, có subfolder)

Tạo các file sau trong `src/modules/<feature>/`:

```
src/modules/<feature>/
├── <feature>.module.ts
├── controllers/
│   └── <feature>.controller.ts
├── decorators/
│   └── <feature>-api.decorator.ts      # Swagger gom tập trung — composite @Api*()
├── services/
│   ├── <feature>.service.ts
│   └── <feature>.service.spec.ts
├── repositories/
│   ├── <feature>.repository.port.ts    # PORT — abstract class + re-export types
│   └── <feature>.repository.prisma.ts  # IMPL — duy nhất import PrismaService
└── dto/
    ├── create-<feature>.dto.ts
    ├── update-<feature>.dto.ts
    └── <feature>-response.dto.ts
```

**Không tạo** file `index.ts` (barrel export).

**Import:** vượt module/layer dùng path alias (`@common/*`, `@core/*`, `@modules/*`, `@generated/*`); trong cùng module dùng relative ngắn (`./`, `../dto/`, `../services/`). KHÔNG dùng `../../../`.

Tham chiếu cụ thể: xem `src/modules/users/` để nắm đúng hình dạng từng file.

---

## BƯỚC 3 — Nội dung từng file (dùng `Product` / `Products` / `product` làm ví dụ)

### `repositories/product.repository.port.ts` — PORT

```ts
import type { Product } from '@generated/prisma/client';

// Re-export shape model qua port → service/test phụ thuộc PORT, không import generated/ trực tiếp.
export type { Product };

export type CreateProductData = {
  name: string;
  price: number;
  // thêm các trường bắt buộc từ Prisma model
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

> Abstract class vừa là **TS type** vừa là **DI token** — module dùng nó làm `provide` key.

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

> File này là **DUY NHẤT** được phép import `PrismaService` và `generated/prisma` trong toàn bộ feature module.

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

> Service inject PORT (`ProductRepository`), không biết gì về Prisma. Import kiểu `Product` từ PORT (không từ `generated/`).

---

### `decorators/products-api.decorator.ts` — Swagger gom tập trung

**Quy tắc bắt buộc:** mọi decorator Swagger sống trong file này dưới dạng composite `applyDecorators`. Controller **không** import trực tiếp từ `@nestjs/swagger`.

- Một decorator class-level: `Api<Feature>Controller()` — gom `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` nếu route cần auth).
- Một decorator per-endpoint: `Api<Action>()` — gom `ApiEnvelopeResponse(...)` (và bất kỳ metadata riêng của route).
- **`status` luôn dùng `HttpStatus.X`** (từ `@nestjs/common`), khớp đúng với `@HttpCode` ở controller — không dùng số magic.

```ts
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { ProductResponseDto } from '../dto/product-response.dto';

// Class-level: tag + error envelope chuẩn + bearer token cho mọi route.
export function ApiProductsController() {
  return applyDecorators(ApiTags('products'), ApiStandardErrorResponses(), ApiBearerAuth());
}

// POST /products — tạo resource → 201 Created, envelope.
export function ApiCreateProduct() {
  return applyDecorators(ApiEnvelopeResponse(ProductResponseDto, { status: HttpStatus.CREATED }));
}

// GET /products — danh sách → 200 OK (dùng `paginated: true` nếu là route phân trang).
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

Ghi chú:
- `JwtAuthGuard` đã được đăng ký toàn cục (global guard), nên không cần thêm `@UseGuards` ở đây. Yêu cầu bearer cho Swagger nằm trong `ApiProductsController()` (qua `ApiBearerAuth()`), không đặt trực tiếp ở controller.
- **Mọi route khai báo `@HttpCode(HttpStatus.X)` tường minh**, dùng cùng `HttpStatus.X` với `status` trong decorator Swagger → runtime và docs luôn khớp.

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

> `{ provide: ProductRepository, useClass: PrismaProductRepository }` là cách NestJS DI biết "khi ai đó inject PORT (`ProductRepository`), hãy cấp IMPL (`PrismaProductRepository`)".

---

### `dto/` — Ba file DTO

Tạo ba file DTO theo lệnh `/create-dto`, truyền vào:
- Tên tính năng
- Danh sách trường suy ra từ model Prisma (hoặc từ người dùng cung cấp nếu model chưa có)

Cấu trúc tổng quát:
- `create-<feature>.dto.ts` — dùng `createZodDto(Schema)` cho các trường bắt buộc.
- `update-<feature>.dto.ts` — dùng `createZodDto(Schema.partial())` hoặc extend create schema.
- `<feature>-response.dto.ts` — bao gồm tất cả các trường trả về (kể cả `id`, `createdAt`, `updatedAt`).

---

### `services/<feature>.service.spec.ts`

Tạo file spec theo lệnh `/create-test`, truyền vào đường dẫn service. Mock **repository PORT** (không phải `PrismaService`):

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

## BƯỚC 4 — Đăng ký module trong `src/app.module.ts`

NestJS **không tự động** phát hiện module. Sau khi tạo xong các file, thêm module mới vào `src/app.module.ts`:

1. Thêm dòng import ở đầu file:
   ```ts
   import { ProductsModule } from './modules/products/products.module';
   ```
2. Thêm `ProductsModule` vào mảng `imports` của `@Module(...)`.

Ví dụ (sau khi chỉnh sửa):
```ts
@Module({
  imports: [
    // ... các module hiện có ...
    ProductsModule,
  ],
})
export class AppModule {}
```

**Không bỏ qua bước này** — nếu không đăng ký, controller sẽ không hoạt động.

---

## Kiểm tra sau khi tạo

Sau khi tạo xong tất cả file, chạy lệnh sau để xác nhận build không bị lỗi:

```bash
pnpm build
```

Nếu có lỗi liên quan đến Prisma types (`Product`, `this.prisma.product`, ...):
- Model đã được thêm vào `prisma/schema.prisma` chưa?
- Đã chạy `pnpm prisma:migrate && pnpm prisma:generate` chưa?

---

## Tóm tắt những gì KHÔNG làm

- KHÔNG sử dụng TypeORM, `TypeOrmModule.forFeature`, `@InjectRepository`.
- KHÔNG tạo file `index.ts` barrel export.
- KHÔNG tự ghi đè `prisma/schema.prisma`.
- KHÔNG inject `PrismaService` vào service — chỉ inject qua repository PORT.
- KHÔNG import `generated/prisma` từ service — chỉ `<feature>.repository.prisma.ts` được làm vậy.
- KHÔNG tạo cấu trúc phẳng (flat) — luôn dùng `controllers/`, `services/`, `repositories/`, `dto/`.
