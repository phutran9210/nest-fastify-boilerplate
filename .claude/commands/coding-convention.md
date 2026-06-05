# /coding-convention — Hướng dẫn chuẩn code dự án NestJS + Fastify

## Mô tả lệnh

Lệnh này có **hai chế độ**:

- **Passive** (không có `$ARGUMENTS`): Claude đọc và áp dụng hướng dẫn này như một tài liệu tham chiếu tự động khi viết hoặc review code. Không cần làm gì thêm — chỉ tuân thủ.
- **Active** (`$ARGUMENTS` được cung cấp): Quét file `.ts` theo phạm vi được chỉ định, liệt kê vi phạm theo định dạng `file:line — vi phạm → cách fix`, và tự động sửa khi có `--fix`.

---

## Cách dùng (Active mode)

```
/coding-convention <scope> [--fix] [--summary]
```

### Các giá trị scope được chấp nhận

| Argument       | Mô tả                                                                 |
|----------------|-----------------------------------------------------------------------|
| `<path>`       | Đường dẫn cụ thể (file hoặc thư mục), ví dụ: `src/modules/user`     |
| `all`          | Toàn bộ dự án (trừ `src/generated`)                                  |
| `--changed`    | Các file `.ts` thay đổi so với base branch (`git diff $BASE...HEAD`) |
| `--dirty`      | Uncommitted + untracked (chưa commit, kể cả file mới chưa stage)     |
| `--staged`     | Các file `.ts` đã được `git add` (staged)                            |

### Modifier

| Modifier    | Mô tả                                                         |
|-------------|---------------------------------------------------------------|
| `--fix`     | Tự động sửa những vi phạm an toàn, sau đó nhắc chạy `pnpm check` |
| `--summary` | Chỉ trả về phần tóm tắt (không liệt kê từng vi phạm)         |

---

## Logic xác định base branch (Active mode)

Sử dụng đoạn script sau để tự động detect base branch — **không hardcode `main`**:

```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

- `--changed` → `git diff --name-only $BASE...HEAD | grep '\.ts$'`
- `--dirty` → union của `git diff --name-only HEAD | grep '\.ts$'` và `git ls-files --others --exclude-standard | grep '\.ts$'`
- `--staged` → `git diff --name-only --cached | grep '\.ts$'`

**Luôn loại trừ `src/generated`** khỏi mọi phạm vi quét (đây là code Prisma tự sinh, Biome bỏ qua).

Sau khi dùng `--fix`, nhắc nhở: **"Nhớ chạy `pnpm check` để format và lint toàn bộ dự án."**

---

## Stack dự án

**NestJS 11 + Fastify + Prisma 7 + nestjs-zod + Zod 4 + @js-temporal/polyfill + Biome 2.4.16 + Jest + pnpm**

Cấu trúc module **phẳng** (flat), single-tenant.

---

## Quy ước — Danh sách kiểm tra

### 1. TypeScript & Biome

- ✅ `any` **được phép dùng** — response DTO dùng `z.any()` có chủ đích. Biome đã tắt `noExplicitAny`.
- ✅ `import type` **không bắt buộc** — Biome đã tắt `useImportType`.
- ✅ Dùng single quotes, trailing comma `all`, semicolon `always`, indent 2 spaces, lineWidth 100.
- ✅ Format/lint: `pnpm check` (= `biome check --write .`), `pnpm lint` (= `biome check .`).
- ❌ Đừng bật `noExplicitAny` hay `useImportType` — chúng đã bị tắt có lý do.

### 2. Import & cấu trúc thư mục

- ✅ Dùng **relative imports**: `../../core/prisma/prisma.service`
- ✅ Cấu trúc phẳng: `src/modules/<feature>/<feature>.controller.ts`, `.service.ts`, `.module.ts`, `dto/`
- ✅ Prisma client/types import từ `../../generated/prisma/client`
- ❌ Không dùng alias `@app/*` — tsconfig có định nghĩa nhưng code không dùng
- ❌ Không tạo subfolder `controllers/`, `services/`, `repositories/`
- ❌ Không tạo file re-export tổng hợp `index.ts` cho module

```ts
// ✅ Đúng
import { PrismaService } from '../../core/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';

// ❌ Sai
import { PrismaService } from '@app/core/prisma/prisma.service';
```

### 3. nestjs-zod & DTO

**Quy tắc bắt buộc:** Dùng pattern dưới đây. **Không được "đơn giản hoá"** — cast kép là bắt buộc để TypeScript suy diễn đúng kiểu generic.

```ts
// ✅ Đúng — giữ nguyên pattern này
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.email(),
  password: z.string().min(8),
});

export class CreateUserDto extends (createZodDto(createUserSchema) as ReturnType<
  typeof createZodDto<typeof createUserSchema>
>) {}
```

```ts
// ❌ Sai — "đơn giản hoá" làm mất type inference
export class CreateUserDto extends createZodDto(createUserSchema) {}
```

- ✅ Controllers dùng `@ZodSerializerDto(Dto)` (mảng: `@ZodSerializerDto([Dto])`)
- ✅ Zod 4: dùng `z.email()` ở top-level (KHÔNG dùng `z.string().email()`)

```ts
// ✅ Đúng (Zod 4)
email: z.email()

// ❌ Sai (Zod 3 style)
email: z.string().email()
```

#### Caveat quan trọng — Date trong response DTO

`z.date()` làm crash `z.toJSONSchema()` mà nestjs-zod gọi khi build Swagger. **Bắt buộc** dùng pattern sau, và **giữ nguyên comment giải thích**:

```ts
// ✅ Đúng — response DTO với Date field
// Dates use `z.any().transform(...)` (Date -> ISO string) on purpose: `z.date()` is not
// representable by Zod v4's `z.toJSONSchema()`, which nestjs-zod calls to build the Swagger
// doc — using `z.date()` here crashes app bootstrap. Do not "simplify".
createdAt: z.any().transform((v: unknown) => (v instanceof Date ? v.toISOString() : String(v))),

// ❌ Sai — crash khi app khởi động
createdAt: z.date(),
```

### 4. Auth

- ✅ `JwtAuthGuard` là global guard (`APP_GUARD`) — mọi endpoint đều được bảo vệ mặc định
- ✅ Endpoint public: dùng `@Public()` từ `src/core/decorators/public.decorator.ts`
- ✅ Controller cần auth: thêm `@ApiBearerAuth()` cho Swagger

```ts
// ✅ Endpoint public
import { Public } from '../../core/decorators/public.decorator';

@Public()
@Get('health')
health() { ... }

// ✅ Controller được bảo vệ
@ApiBearerAuth()
@Controller('users')
export class UsersController { ... }
```

### 5. Prisma 7

- ✅ Service inject `PrismaService` (extends `PrismaClient`) — không dùng repository class riêng
- ✅ Không tìm thấy record → `throw new NotFoundException(\`User ${id} not found\`)` (template literal)
- ✅ Lỗi Prisma: kiểm tra qua `instanceof Prisma.PrismaClientKnownRequestError` + `code`
  - `P2002`: unique constraint
  - `P2025`: record not found
  - `P2003`: foreign key constraint
- ✅ Multi-step writes → `prisma.$transaction([...])` hoặc `$transaction(async (tx) => …)`
- ✅ Tránh N+1: dùng `include`/`select` thay vì loop query

```ts
// ✅ Đúng — inject PrismaService
constructor(private readonly prisma: PrismaService) {}

// ✅ Đúng — NotFoundException
const user = await this.prisma.user.findUnique({ where: { id } });
if (!user) throw new NotFoundException(`User ${id} not found`);

// ✅ Đúng — xử lý lỗi Prisma
import { Prisma } from '../../generated/prisma/client';

if (error instanceof Prisma.PrismaClientKnownRequestError) {
  if (error.code === 'P2002') throw new ConflictException('Email already exists');
}

// ✅ Đúng — N+1 phòng tránh
const users = await this.prisma.user.findMany({ include: { posts: true } });

// ❌ Sai — N+1
const users = await this.prisma.user.findMany();
for (const user of users) {
  user.posts = await this.prisma.post.findMany({ where: { userId: user.id } });
}
```

### 6. Date/Time — Temporal API

Dùng `@js-temporal/polyfill` cho mọi logic liên quan đến ngày giờ. **Không dùng `new Date()`** cho date logic.

```ts
// ✅ Đúng
import { Temporal, toTemporalInstant } from '@js-temporal/polyfill';

const now = Temporal.Now.instant();
const today = Temporal.Now.plainDateISO();
const expiresAt = Temporal.Now.instant().add({ hours: 1 });

// Convert Prisma Date sang Temporal — dùng toTemporalInstant (function import)
const instant = toTemporalInstant.call(someDate);

// ❌ Sai — không gọi như method trên Date instance
const instant = someDate.toTemporalInstant();

// ❌ Sai — không dùng new Date() cho date logic
const now = new Date();
const expires = new Date(Date.now() + 3600 * 1000);
```

> **Lưu ý:** Prisma `DateTime` column vẫn trả về `Date` object của JS. Chỉ convert sang Temporal khi cần tính toán.

### 7. Testing (Jest)

- ✅ File `*.spec.ts` **đặt cùng thư mục** với source (colocated), không đặt trong `__tests__/`
- ✅ Mock = plain object + `useValue` trong `Test.createTestingModule`
- ✅ `jest.clearAllMocks()` trong `beforeEach`
- ✅ Tên test mô tả **hành vi** — không bắt buộc "should … when …"
- ✅ Assert cụ thể: `toHaveBeenCalledWith`, `rejects.toBeInstanceOf`, `rejects.toMatchObject({ status: 404 })`
- ❌ Không dùng `jest.mock` ở top-level module
- ❌ Không bắt buộc comment `// Arrange / Act / Assert`
- ❌ Không đặt spec file trong `__tests__/`

```ts
// ✅ Đúng
describe('UsersService', () => {
  let service: UsersService;
  const mockPrisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('ném NotFoundException khi không tìm thấy user', async () => {
    mockPrisma.user.findUnique.mockResolvedValue(null);
    await expect(service.findOne('999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

---

## Output Format (Active mode)

### Danh sách vi phạm (mặc định)

```
src/modules/user/user.service.ts:42 — Dùng `new Date()` cho date logic → Thay bằng `Temporal.Now.instant()`
src/modules/user/dto/create-user.dto.ts:8 — `z.string().email()` (Zod 3 style) → Dùng `z.email()` (Zod 4)
src/modules/auth/auth.service.ts:15 — `z.date()` trong response DTO sẽ crash bootstrap → Dùng `z.any().transform(...)`
```

Định dạng mỗi dòng: `file:line — vi phạm → cách fix`

### Tóm tắt

```
Tổng kết:
  Files đã quét:       12
  Files sạch:           9
  Files có vi phạm:     3
  Tổng số vi phạm:      5
```

- `--summary`: chỉ trả về phần tóm tắt, không liệt kê từng vi phạm.
- `--fix`: tự động sửa những vi phạm an toàn, sau đó nhắc: **"Nhớ chạy `pnpm check` để format và lint toàn bộ dự án."**

---

## Những gì KHÔNG thuộc dự án này

Các pattern sau **không được dùng** — chúng thuộc project khác/cũ hơn:

- ORM dạng decorator (Active Record / Data Mapper với entity class và inject repository)
- Thư viện thao tác ngày giờ kiểu cũ (momentjs, thư viện bắt đầu bằng "day")
- Decorator validation theo kiểu class-based (validation-by-decorator trên property)
- Kiến trúc đa tenant / phân tách theo tổ chức (org/tenant)
- Hằng số tập trung cho thông báo lỗi hoặc ràng buộc (ví dụ object `ERRORS`, `LIMITS`)
- File re-export tổng hợp cho mỗi module
- Factory config dạng `register-as` của `@nestjs/config` (không dùng trong project này)
- Hardcode tên branch trong git diff range — luôn dùng biến `$BASE` thay vì cố định tên branch
