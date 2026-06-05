# /create-module

Scaffold mot feature module day du theo phong cach flat cua du an nay (NestJS 11 + Fastify + Prisma 7 + nestjs-zod).

**Dau vao:** `$ARGUMENTS` la ten tinh nang (vi du: `product`, `order`, `category`).

---

## Quy tac dat ten

| Dang           | Vi du (input: `product`)  |
|----------------|---------------------------|
| camelCase      | `product`                 |
| PascalCase     | `Product`                 |
| pluralCamel    | `products`                |
| pluralPascal   | `Products`                |
| kebab          | `product`                 |

Neu input la `product-category`, dieu chinh tuong ung: `productCategory`, `ProductCategory`, `product-categories`, v.v.

---

## BUOC 1 (bat buoc) — Kiem tra model Prisma truoc khi tao code

Day la buoc quan trong nhat. Thuc hien theo thu tu sau:

1. Doc noi dung file `prisma/schema.prisma`.
2. Tim kiem model co ten PascalCase tuong ung (vi du: `Product`) trong file do.
3. **Neu model TON TAI:**
   - Tiep tuc sang Buoc 2 (tao day du CRUD co Prisma).
   - Ghi nho cac truong cua model de suy ra DTO (de su dung o Buoc 3).
4. **Neu model KHONG TON TAI:**
   - DUNG lai, KHONG tao service/repository co goi Prisma (vi code se khong bien dich duoc).
   - Thong bao cho nguoi dung:
     > "Model `<Feature>` chua ton tai trong `prisma/schema.prisma`. Ban can them model truoc roi chay `pnpm prisma:migrate && pnpm prisma:generate`."
   - Hoi nguoi dung ve cac truong can thiet, hoac yeu cau ho cung cap.
   - Tao mot **goi y model** de nguoi dung tu dan vao `schema.prisma` (KHONG tu ghi de len file nay).
   - Scaffold module o dang **TODO stub** (cac phuong thuc service tra ve `throw new Error('TODO')`) de build khong bi loi.
   - Dung lai sau khi hoan thanh stub, nhac nguoi dung bo sung Prisma truoc khi dung that.

> **Luuu y:** Lenh nay KHONG duoc tu ghi de `prisma/schema.prisma`.

---

## BUOC 2 — Cau truc thu muc (flat, khong co thu muc con)

Tao cac file sau trong `src/modules/<feature>/`:

```
src/modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts
├── <feature>.service.ts
├── <feature>.service.spec.ts
└── dto/
    ├── create-<feature>.dto.ts
    ├── update-<feature>.dto.ts
    └── <feature>-response.dto.ts
```

**Khong tao** file `index.ts` (barrel export), **khong tao** thu muc con nao ngoai `dto/`.

---

## BUOC 3 — Noi dung tung file (dung `Product` / `Products` / `product` lam vi du)

### `products.module.ts`

```ts
import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
```

---

### `products.service.ts`

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma, Product } from '../../generated/prisma/client';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.ProductCreateInput): Promise<Product> {
    return this.prisma.product.create({ data });
  }

  findAll(): Promise<Product[]> {
    return this.prisma.product.findMany();
  }

  async findOne(id: string): Promise<Product> {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) {
      throw new NotFoundException(`Product ${id} not found`);
    }
    return product;
  }

  async update(id: string, data: Prisma.ProductUpdateInput): Promise<Product> {
    await this.findOne(id);
    return this.prisma.product.update({ where: { id }, data });
  }

  async remove(id: string): Promise<Product> {
    await this.findOne(id);
    return this.prisma.product.delete({ where: { id } });
  }
}
```

Thay the `Product`, `product`, `ProductCreateInput`, `ProductUpdateInput` bang ten tinh nang tuong ung.

---

### `products.controller.ts`

```ts
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductResponseDto } from './dto/product-response.dto';
import { ProductsService } from './products.service';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductsController {
  constructor(private readonly products: ProductsService) {}

  @Post()
  @ZodSerializerDto(ProductResponseDto)
  @ApiCreatedResponse({ type: ProductResponseDto })
  create(@Body() dto: CreateProductDto) {
    return this.products.create(dto);
  }

  @Get()
  @ZodSerializerDto(ProductResponseDto)
  @ApiOkResponse({ type: [ProductResponseDto] })
  findAll() {
    return this.products.findAll();
  }

  @Get(':id')
  @ZodSerializerDto(ProductResponseDto)
  @ApiOkResponse({ type: ProductResponseDto })
  findOne(@Param('id') id: string) {
    return this.products.findOne(id);
  }

  @Patch(':id')
  @ZodSerializerDto(ProductResponseDto)
  @ApiOkResponse({ type: ProductResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateProductDto) {
    return this.products.update(id, dto);
  }

  @Delete(':id')
  @ZodSerializerDto(ProductResponseDto)
  @ApiOkResponse({ type: ProductResponseDto })
  remove(@Param('id') id: string) {
    return this.products.remove(id);
  }
}
```

Ghi chu: `JwtAuthGuard` da duoc dang ky toan cuc (global guard), nen khong can them `@UseGuards` o day. Chi can `@ApiBearerAuth()` de Swagger hien thi khoa bao mat.

---

### `dto/` — Ba file DTO

Tao ba file DTO theo lenh `/create-dto`, truyen vao:
- Ten tinh nang
- Danh sach truong suy ra tu model Prisma (hoac tu nguoi dung cung cap neu model chua co)

Cau truc tong quat:
- `create-<feature>.dto.ts` — dung `createZodDto(Schema)` cho cac truong bat buoc.
- `update-<feature>.dto.ts` — dung `createZodDto(Schema.partial())` hoac extend create schema.
- `<feature>-response.dto.ts` — bao gom tat ca cac truong tra ve (ke ca `id`, `createdAt`, `updatedAt`).

---

### `<feature>.service.spec.ts`

Tao file spec theo lenh `/create-test`, truyen vao ten service va cac phuong thuc can test (`create`, `findAll`, `findOne`, `update`, `remove`).

---

## BUOC 4 — Dang ky module trong `src/app.module.ts`

NestJS **khong tu dong** phat hien module. Sau khi tao xong cac file, them module moi vao `src/app.module.ts`:

1. Them dong import o dau file:
   ```ts
   import { ProductsModule } from './modules/products/products.module';
   ```
2. Them `ProductsModule` vao mang `imports` cua `@Module(...)`.

Vi du (sau khi chinh sua):
```ts
@Module({
  imports: [
    // ... cac module hien co ...
    ProductsModule,
  ],
})
export class AppModule {}
```

**Khong bo qua buoc nay** — neu khong dang ky, controller se khong hoat dong.

---

## Kiem tra sau khi tao

Sau khi tao xong tat ca file, chay lenh sau de xac nhan build khong bi loi:

```bash
pnpm build
```

Neu co loi lien quan den Prisma types (`Product`, `Prisma.ProductCreateInput`, ...), kiem tra lai:
- Model da duoc them vao `prisma/schema.prisma` chua?
- Da chay `pnpm prisma:generate` chua?

---

## Tom tat nhung gi KHONG lam

- KHONG su dung TypeORM, `TypeOrmModule.forFeature`, `@InjectRepository`.
- KHONG tao file `index.ts` barrel export.
- KHONG tao thu muc con ngoai `dto/` (tat ca file nam phang trong `src/modules/<feature>/`).
- KHONG tu ghi de `prisma/schema.prisma`.
- KHONG tao custom repository class rieng.
