# Bộ slash commands `.claude/commands/` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo 6 slash commands (`/coding-convention`, `/review-code`, `/create-module`, `/create-dto`, `/create-test`, `/create-tdd`) + `CLAUDE.md` cho dự án nest-fastify, adapt đúng stack Prisma 7 / nestjs-zod / Zod 4 / Temporal / Biome.

**Architecture:** Mỗi command là 1 file markdown trong `.claude/commands/` (tên file = tên lệnh, không subfolder). Mỗi file chứa hướng dẫn tiếng Việt + example code đúng stack. `CLAUDE.md` ở root tóm tắt convention để auto-load. Nguồn chân lý: `docs/superpowers/specs/2026-06-05-claude-commands-suite-design.md` (§3 = stack facts, §4 = từng command).

**Tech Stack:** Markdown (Claude Code custom commands). Nội dung tham chiếu: NestJS 11, Fastify, Prisma 7 (`prisma-client` generator), nestjs-zod, Zod 4, `@js-temporal/polyfill`, Biome 2.4, Jest, pnpm.

---

## Canonical templates (dùng lại xuyên suốt — KHÔNG đổi tên/khác biệt giữa các file)

Các snippet dưới là "single source of truth" cho code mẫu trong các command. Khi 1 task nói "chèn DTO template", dùng đúng bản này.

**T1 — Zod create DTO:**
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

**T2 — Zod update DTO (partial):**
```ts
import { createZodDto } from 'nestjs-zod';
import { createProductSchema } from './create-product.dto';

export const updateProductSchema = createProductSchema.partial();

export class UpdateProductDto extends (createZodDto(updateProductSchema) as ReturnType<
  typeof createZodDto<typeof updateProductSchema>
>) {}
```

**T3 — Zod response DTO (date caveat BẮT BUỘC giữ comment):**
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

**T4 — Service (Prisma, NotFoundException template literal):**
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

**T5 — Controller (nestjs-zod serializer + Swagger):**
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

**T6 — Module:**
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

**T7 — Service spec (Jest, plain-object mock):**
```ts
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../core/prisma/prisma.service';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const prisma = {
    product: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [ProductsService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  it('findOne throws NotFoundException when the product does not exist', async () => {
    prisma.product.findUnique.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(prisma.product.findUnique).toHaveBeenCalledWith({ where: { id: 'missing' } });
  });
});
```

**T8 — Base-branch detect (shell, dùng trong coding-convention & review-code):**
```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

**T9 — Temporal usage:**
```ts
import { Temporal, toTemporalInstant } from '@js-temporal/polyfill';

const now = Temporal.Now.instant();                          // exact time
const today = Temporal.Now.plainDateISO();                   // calendar date
const expiresAt = Temporal.Now.instant().add({ hours: 1 });  // arithmetic
// Convert a Prisma `Date` column for calculation:
const instant = toTemporalInstant.call(someDate);            // NOT someDate.toTemporalInstant()
```

---

## File Structure

- Create: `.claude/commands/coding-convention.md` — guideline passive + scan/fix active
- Create: `.claude/commands/review-code.md` — review chất lượng theo tiêu chí
- Create: `.claude/commands/create-module.md` — sinh feature module phẳng
- Create: `.claude/commands/create-dto.md` — sinh zod DTO
- Create: `.claude/commands/create-test.md` — sinh Jest spec colocated
- Create: `.claude/commands/create-tdd.md` — workflow red-green-refactor
- Create: `CLAUDE.md` (root) — tóm tắt stack + convention auto-load

Mỗi file độc lập. Thứ tự build: convention trước (là nền tham chiếu của các file khác), rồi generators, rồi review, rồi CLAUDE.md.

---

### Task 1: `coding-convention.md`

**Files:**
- Create: `.claude/commands/coding-convention.md`

- [ ] **Step 1: Viết file** theo spec §4.1 + §3 (toàn bộ stack facts). Cấu trúc nội dung:
  - Tiêu đề + mô tả 2 chế độ (Passive / Active).
  - Phần "Tham số": path / `all` / `--changed` / `--dirty` / `--staged` / `--fix` / `--summary`.
  - Phần "Quy trình Active": xác định scope (chèn **T8** cho `$BASE`; `--dirty` = `git diff --name-only HEAD` ∪ `git ls-files --others --exclude-standard`; **loại trừ `src/generated`**, chỉ `.ts`).
  - Phần "Guideline" = checklist theo nhóm, mỗi nhóm có ví dụ ✅/❌:
    - TypeScript/Biome: `any` ĐƯỢC PHÉP, `import type` không bắt buộc, single quote, `pnpm check`.
    - Import & structure: relative import, flat, không barrel.
    - nestjs-zod: pattern **T1/T3**, date caveat, `z.email()`.
    - Auth opt-out: global `JwtAuthGuard` + `@Public()` + `@ApiBearerAuth()`.
    - Prisma: **T4**, NotFoundException template literal, error codes P2002/P2025/P2003, `$transaction`.
    - Temporal: **T9**, không `new Date()` cho logic.
    - Testing: style **T7** (§3.7).
  - Nhắc chạy `pnpm check` sau `--fix`.
  - Toàn bộ tiếng Việt.

- [ ] **Step 2: Verify không lẫn dấu vết CRM.**

Run:
```bash
grep -niE "typeorm|dayjs|class-validator|@InjectRepository|workspace|multi-tenant|MESSAGES|barrel|registerAs|\\bmain\\.\\.\\.HEAD" .claude/commands/coding-convention.md
```
Expected: **không có dòng nào** in ra (exit 1). Nếu có `main...HEAD` literal → thay bằng `$BASE...HEAD`.

- [ ] **Step 3: Verify các idiom đúng stack có mặt.**

Run:
```bash
grep -cE "createZodDto|ZodSerializerDto|prisma|Temporal|@Public|toTemporalInstant|src/generated|ls-files --others" .claude/commands/coding-convention.md
```
Expected: số ≥ 6 (các idiom cốt lõi xuất hiện).

- [ ] **Step 4: Commit.**
```bash
git add .claude/commands/coding-convention.md
git commit -m "feat(commands): add /coding-convention (Prisma/zod/Temporal stack)"
```

---

### Task 2: `create-dto.md`

**Files:**
- Create: `.claude/commands/create-dto.md`

- [ ] **Step 1: Viết file** theo spec §4.4. Nội dung:
  - Tham số: `$ARGUMENTS` = tên + loại (`create`/`update`/`response`/`query`) [+ field tùy chọn].
  - Nguồn field (thứ tự ưu tiên): (1) suy từ model trong `prisma/schema.prisma`, (2) field tường minh trong args, (3) hỏi user. KHÔNG đoán bừa.
  - Templates: chèn **T1** (create), **T2** (update), **T3** (response, GIỮ comment date caveat), và query DTO mẫu dùng `z.coerce.number()` cho `page`/`limit`.
  - Ghi chú Zod 4: `z.email()`, `z.iso.datetime()`, `.partial()`.
  - Nơi đặt file: `src/modules/<feature>/dto/`.

- [ ] **Step 2: Verify date caveat + pattern.**
```bash
grep -q "Do not \"simplify\"" .claude/commands/create-dto.md && grep -q "as ReturnType<" .claude/commands/create-dto.md && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Verify no CRM.**
```bash
grep -niE "class-validator|@IsString|@ApiProperty\\(|ApiPropertyOptional|MaxLength|CONSTRAINTS" .claude/commands/create-dto.md
```
Expected: không dòng nào (exit 1).

- [ ] **Step 4: Commit.**
```bash
git add .claude/commands/create-dto.md
git commit -m "feat(commands): add /create-dto (nestjs-zod DTOs)"
```

---

### Task 3: `create-test.md`

**Files:**
- Create: `.claude/commands/create-test.md`

- [ ] **Step 1: Viết file** theo spec §4.5 + §3.7. Nội dung:
  - Tham số: path tới service/controller.
  - Quy tắc: file `*.spec.ts` **colocated** (không `__tests__/`); mock = plain object + `useValue`; `jest.clearAllMocks()` trong `beforeEach`; tên test mô tả hành vi (KHÔNG ép `should…when…`, KHÔNG ép comment AAA); assert cụ thể (`toHaveBeenCalledWith`, `rejects.toBeInstanceOf`, `rejects.toMatchObject({ status: 404 })`).
  - Chèn **T7** làm ví dụ mock `PrismaService`. Thêm 1 ví dụ mock service phụ thuộc (kiểu `{ findByEmail: jest.fn() }`).
  - Lệnh chạy: `pnpm test` (hoặc `pnpm test <path>`).

- [ ] **Step 2: Verify style.**
```bash
grep -q "useValue" .claude/commands/create-test.md && grep -q "clearAllMocks" .claude/commands/create-test.md && grep -q "colocated\|cạnh source\|cùng cấp" .claude/commands/create-test.md && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Verify no CRM / no forced AAA.**
```bash
grep -niE "__tests__|should .* when |createMock[A-Z]|TypeORM" .claude/commands/create-test.md
```
Expected: không dòng nào (exit 1). (Cho phép nhắc rõ "KHÔNG dùng `__tests__`" — nếu match chỉ ở câu phủ định đó thì OK; kiểm tra ngữ cảnh.)

- [ ] **Step 4: Commit.**
```bash
git add .claude/commands/create-test.md
git commit -m "feat(commands): add /create-test (Jest colocated specs)"
```

---

### Task 4: `create-module.md`

**Files:**
- Create: `.claude/commands/create-module.md`

- [ ] **Step 1: Viết file** theo spec §4.3. Nội dung:
  - Tham số: `$ARGUMENTS` = tên module.
  - Sơ đồ cây file phẳng (module/controller/service/spec + dto/{create,update,response}).
  - **Precondition BẮT BUỘC:** đọc `prisma/schema.prisma`, kiểm tra model `<Feature>` (PascalCase). Nếu CÓ → sinh CRUD đầy đủ + suy field DTO từ model. Nếu KHÔNG → DỪNG phần Prisma, hướng dẫn thêm model + `pnpm prisma:migrate && pnpm prisma:generate`, hoặc sinh sườn không gọi Prisma (TODO) để không vỡ build. KHÔNG tự ghi đè schema.
  - Chèn **T6** (module), **T5** (controller), **T4** (service), **T7** (spec), và trỏ `/create-dto` cho dto.
  - Bước cuối: đăng ký module vào `src/app.module.ts` `imports` (chỉ ra cách thêm import + thêm vào mảng `imports`).
  - Nhắc `/create-test` cho spec controller nếu cần.

- [ ] **Step 2: Verify precondition + đăng ký app.module.**
```bash
grep -q "prisma/schema.prisma" .claude/commands/create-module.md && grep -q "app.module.ts" .claude/commands/create-module.md && grep -qiE "precondition|model.*tồn tại|kiểm tra model" .claude/commands/create-module.md && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Verify flat structure (không subfolder controllers/services).**
```bash
grep -niE "controllers/|services/|repositories/|barrel|index\\.ts" .claude/commands/create-module.md
```
Expected: không dòng nào (exit 1).

- [ ] **Step 4: Commit.**
```bash
git add .claude/commands/create-module.md
git commit -m "feat(commands): add /create-module (flat Prisma module + model precondition)"
```

---

### Task 5: `create-tdd.md`

**Files:**
- Create: `.claude/commands/create-tdd.md`

- [ ] **Step 1: Viết file** theo spec §4.6. Nội dung:
  - Workflow 5 bước: (1) viết test đỏ theo `/create-test`, (2) `pnpm test` xác nhận đỏ, (3) code tối thiểu cho xanh, (4) refactor, (5) `pnpm check`.
  - Nhấn mạnh: KHÔNG viết implementation trước test. Mỗi vòng commit nhỏ.
  - Trỏ tham chiếu `/create-test` (style mock) và `/coding-convention` (quy ước code).

- [ ] **Step 2: Verify nội dung workflow.**
```bash
grep -qiE "pnpm test" .claude/commands/create-tdd.md && grep -qiE "đỏ|red|fail" .claude/commands/create-tdd.md && grep -q "create-test" .claude/commands/create-tdd.md && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit.**
```bash
git add .claude/commands/create-tdd.md
git commit -m "feat(commands): add /create-tdd (red-green-refactor workflow)"
```

---

### Task 6: `review-code.md`

**Files:**
- Create: `.claude/commands/review-code.md`

- [ ] **Step 1: Viết file** theo spec §4.2. Nội dung:
  - Tham số + scope flags giống coding-convention (chèn **T8** cho `$BASE`; `--dirty` gồm untracked; loại trừ `src/generated`).
  - 10 tiêu chí: Correctness; Security (auth opt-out, `@Public()` không lạm dụng, secret-stripping CHÍNH qua `@ZodSerializerDto` — KHÔNG mandate `select`); Error handling (Prisma codes, NotFoundException, controller không try/catch nuốt lỗi); Data integrity (`$transaction`, unique DB); Performance (N+1 qua `include`/`select`, pagination); Prisma & query quality (codes, transaction không bọc external call, `select` = defense-in-depth khuyến nghị); API design (REST, status, Swagger nestjs-zod); Readability; Testing (style §3.7); Conventions (trỏ `/coding-convention`).
  - **Bỏ** multi-tenant SQL, TypeORM migration, raw QueryBuilder.
  - Output: bảng PASS/WARN/FAIL theo tiêu chí + summary CRITICAL/HIGH/MEDIUM/LOW + top 3 priorities. `--fix` cho cái auto-fix được, `--summary` chỉ tổng kết.
  - Tiếng Việt.

- [ ] **Step 2: Verify select không bị mandate + no CRM.**
```bash
grep -qiE "defense-in-depth|không bắt buộc|không.*mandate|khuyến nghị" .claude/commands/review-code.md && echo SELECT_OK
grep -niE "typeorm|multi-tenant|workspace|QueryBuilder|migration safety|dayjs" .claude/commands/review-code.md
```
Expected: `SELECT_OK` in ra; lệnh grep thứ 2 không có dòng nào (exit 1).

- [ ] **Step 3: Verify tiêu chí cốt lõi có mặt.**
```bash
grep -cE "@ZodSerializerDto|@Public|PrismaClientKnownRequestError|P2002|\\$transaction|PASS/WARN/FAIL|CRITICAL" .claude/commands/review-code.md
```
Expected: số ≥ 5.

- [ ] **Step 4: Commit.**
```bash
git add .claude/commands/review-code.md
git commit -m "feat(commands): add /review-code (Prisma single-tenant criteria)"
```

---

### Task 7: `CLAUDE.md` (root)

**Files:**
- Create: `CLAUDE.md`

- [ ] **Step 1: Viết file** theo spec §4.7. ~1 trang:
  - Phần "Stack": NestJS 11 + Fastify, Prisma 7 (`prisma-client` generator, client ở `src/generated/prisma`), nestjs-zod + Zod 4, `@js-temporal/polyfill`, BullMQ, RabbitMQ, Biome, Jest, pnpm.
  - Phần "Lệnh chính": `pnpm start:dev`, `pnpm test`, `pnpm check`, `pnpm lint`, `pnpm prisma:migrate`, `pnpm prisma:generate`.
  - Phần "Convention cốt lõi" (bản rút gọn §3, nhấn): `any` được phép; auth opt-out (global `JwtAuthGuard` + `@Public()`); date caveat trong response DTO; Temporal cho logic ngày (chèn 1 dòng **T9** rút gọn); relative import; flat structure; NotFoundException template literal; test colocated.
  - Phần "Slash commands": liệt kê 6 lệnh + 1 dòng mô tả mỗi lệnh, trỏ `.claude/commands/`.

- [ ] **Step 2: Verify nội dung then chốt.**
```bash
grep -qiE "any.*được phép|noExplicitAny" CLAUDE.md && grep -q "@Public" CLAUDE.md && grep -qiE "z.any\\(\\).transform|date caveat|toJSONSchema" CLAUDE.md && grep -q "Temporal" CLAUDE.md && grep -q "/coding-convention" CLAUDE.md && echo OK
```
Expected: `OK`.

- [ ] **Step 3: Commit.**
```bash
git add CLAUDE.md
git commit -m "docs: add root CLAUDE.md (stack + conventions + command index)"
```

---

### Task 8: Smoke check toàn bộ

- [ ] **Step 1: Liệt kê file đã tạo.**
```bash
ls -1 .claude/commands/ && test -f CLAUDE.md && echo "CLAUDE.md OK"
```
Expected: 6 file `.md` + `CLAUDE.md OK`.

- [ ] **Step 2: Quét CRM leftover toàn bộ thư mục commands + CLAUDE.md.**
```bash
grep -rniE "typeorm|dayjs|class-validator|@InjectRepository|multi-tenant|getWorkspaceSchemaName" .claude/commands/ CLAUDE.md
```
Expected: không dòng nào (exit 1). Bất kỳ match nào = sửa file tương ứng trước khi đóng.

- [ ] **Step 3: Verify mọi command đề cập đúng lệnh pnpm (không `npm`/`yarn`).**
```bash
grep -rniE "\\bnpm run\\b|\\byarn \\b" .claude/commands/ CLAUDE.md
```
Expected: không dòng nào (exit 1).

- [ ] **Step 4: Commit (nếu có chỉnh ở smoke check; nếu sạch thì bỏ qua).**
```bash
git add -A && git commit -m "chore(commands): smoke-check fixups" || echo "nothing to commit"
```

---

## Notes
- Không chạy app/migration trong plan này — chỉ tạo file hướng dẫn. Verify = grep tĩnh.
- `master` là branch hiện hành; không tạo branch mới (đang ở `feat/nestjs-fastify-boilerplate`).
- Nếu bất kỳ verify step nào fail, sửa file rồi chạy lại trước khi commit.
