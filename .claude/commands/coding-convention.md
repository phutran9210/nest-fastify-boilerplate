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
| `<path>`       | Đường dẫn cụ thể (file hoặc thư mục), ví dụ: `src/modules/users`    |
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

Single-tenant. Cấu trúc module theo **feature-first** với phân tầng rõ ràng:

- `src/common/` — cross-cutting concerns: `decorators/`, `filters/`, `guards/`, `interceptors/`
- `src/core/` — infrastructure: `config/`, `prisma/`, `queue/`, `messaging/`, `health/`
- `src/modules/` — business features, mỗi feature có subfolders riêng

---

## Quy ước — Danh sách kiểm tra

### 1. TypeScript & Biome

- ✅ `any` **được phép dùng** — response DTO dùng `z.any()` có chủ đích. Biome đã tắt `noExplicitAny`.
- ✅ `import type` **không bắt buộc** — Biome đã tắt `useImportType`.
- ✅ Dùng single quotes, trailing comma `all`, semicolon `always`, indent 2 spaces, lineWidth 100.
- ✅ Format/lint: `pnpm check` (= `biome check --write .`), `pnpm lint` (= `biome check .`).
- ❌ Đừng bật `noExplicitAny` hay `useImportType` — chúng đã bị tắt có lý do.

### 2. Import & cấu trúc thư mục

- ✅ **Import vượt cấp (khác module/layer) dùng path alias** — `@common/*`, `@core/*`, `@modules/*`, `@generated/*` (khai báo ở `tsconfig.json` `paths`, `.swcrc` `jsc.paths`, `jest.config.js` `moduleNameMapper`)
- ✅ **Import trong cùng module** vẫn dùng relative ngắn: `./`, `../dto/`, `../services/` — KHÔNG alias hoá
- ✅ Cấu trúc feature-first: mỗi module nằm trong `src/modules/<feature>/` với các subfolder:
  - `controllers/` — controller file(s)
  - `decorators/` — composite Swagger decorator (`<feature>-api.decorator.ts`)
  - `services/` — service file(s) và file `*.spec.ts` colocated
  - `dto/` — Zod DTO files
  - `repositories/` — port (abstract class) + Prisma impl (khi có DB access)
  - `strategies/` — Passport strategies (chỉ cho auth)
  - `jobs/` — BullMQ processors (chỉ cho mail/queue features)
- ✅ File module nằm thẳng trong `src/modules/<feature>/`: `<feature>.module.ts`
- ❌ KHÔNG dùng `../../../` cho import vượt module/layer — thay bằng alias
- ❌ Không tạo file re-export tổng hợp `index.ts` cho module

```ts
// ✅ Đúng — cùng module dùng relative, vượt cấp dùng alias
import { UserRepository } from '../repositories/user.repository';
import { PrismaService } from '@core/prisma/prisma.service';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { User } from '@generated/prisma/client';

// ❌ Sai — vượt cấp mà vẫn dùng ../../../
import { PrismaService } from '../../../core/prisma/prisma.service';
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
- ✅ Endpoint public: dùng `@Public()` từ `src/common/decorators/public.decorator.ts`
- ✅ Controller cần auth: yêu cầu bearer cho Swagger qua `ApiBearerAuth()` đặt **bên trong** composite decorator của module (xem mục 5 bên dưới), KHÔNG đặt trực tiếp ở controller

```ts
// ✅ Endpoint public
import { Public } from '@common/decorators/public.decorator';

@Public()
@Get('health')
health() { ... }

// ✅ Controller được bảo vệ — bearer nằm trong ApiUsersController()
@ApiUsersController()
@Controller('users')
export class UsersController { ... }
```

### 5. Swagger — gom tập trung trong `decorators/`

- ✅ Mỗi controller có file `<module>/decorators/<feature>-api.decorator.ts` chứa toàn bộ metadata Swagger dưới dạng composite `applyDecorators`
- ✅ Class-level: `Api<Feature>Controller()` — gom `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` nếu cần auth)
- ✅ Per-endpoint: `Api<Action>()` — gom `ApiEnvelopeResponse(...)` và metadata riêng của route
- ❌ Controller KHÔNG được `import` trực tiếp từ `@nestjs/swagger` — chỉ import các `Api*()` từ `decorators/`
- ✅ Áp dụng cho **mọi** controller, kể cả route chỉ có `ApiTags` (mail, notifications, health…)

```ts
// ✅ Đúng — decorators/users-api.decorator.ts
import { applyDecorators } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse, ApiStandardErrorResponses } from '@common/http/api-envelope.decorator';
import { UserResponseDto } from '../dto/user-response.dto';

export function ApiUsersController() {
  return applyDecorators(ApiTags('users'), ApiStandardErrorResponses(), ApiBearerAuth());
}
export function ApiCreateUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.CREATED }));
}

// ❌ Sai — Swagger decorator nằm rải rác trong controller
@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController { ... }
```

### 6. HTTP status — `@HttpCode` tường minh + đồng bộ với Swagger

- ✅ **Mọi** route HTTP phải khai báo `@HttpCode(HttpStatus.X)` tường minh (import từ `@nestjs/common`) — KHÔNG dựa vào mặc định ngầm của Nest (POST→201, còn lại→200)
- ✅ `status` trong `ApiEnvelopeResponse(..., { status: HttpStatus.X })` dùng **cùng** `HttpStatus.X` với `@HttpCode` → runtime và Swagger luôn khớp
- ❌ KHÔNG dùng số magic (`200`, `201`, `202`) — luôn dùng enum `HttpStatus`
- Quy ước: tạo resource → `CREATED`; đọc/sửa/xóa trả body → `OK`; hành động bất đồng bộ (enqueue/publish) → `ACCEPTED`

```ts
// ✅ Đúng — @HttpCode khớp status trong decorator
import { HttpCode, HttpStatus } from '@nestjs/common';

@Post()
@HttpCode(HttpStatus.CREATED)   // runtime 201
@ApiCreateUser()                // ApiEnvelopeResponse(..., { status: HttpStatus.CREATED })
create(@Body() dto: CreateUserDto) { ... }

// ❌ Sai — không khai báo @HttpCode (dựa default), hoặc số magic lệch với docs
@Post()
@ApiCreateUser()  // docs 201 nhưng runtime cũng 201 do may mắn — vẫn FAIL vì thiếu @HttpCode
create(@Body() dto: CreateUserDto) { ... }
```

### 7. Data access — Repository port pattern

- ✅ **Service inject PORT** (`abstract class <Feature>Repository`) — KHÔNG inject `PrismaService` trực tiếp
- ✅ **Port** (`repositories/<feature>.repository.ts`) là `abstract class <Feature>Repository` — đóng vai trò là TS type VÀ DI token; re-export model type qua `export type { <Model> }`; định nghĩa `Create<Feature>Data` và `Update<Feature>Data`
- ✅ **Prisma impl** (`repositories/prisma-<feature>.repository.ts`) là class `@Injectable() Prisma<Feature>Repository extends <Feature>Repository` — file DUY NHẤT import `PrismaService` và `generated/prisma`
- ✅ **Module wiring**: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`
- ✅ Service import kiểu model TỪ PORT (không import từ `generated/prisma` trực tiếp)
- ❌ Service KHÔNG được gọi `this.prisma.*` hay import `generated/prisma`

```ts
// ✅ Đúng — port (repositories/user.repository.ts)
export type { User };
export type CreateUserData = { email: string; password: string; name?: string | null };
export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract create(data: CreateUserData): Promise<User>;
  // ...
}

// ✅ Đúng — Prisma impl (repositories/prisma-user.repository.ts)
import { PrismaService } from '@core/prisma/prisma.service';
import type { User } from '@generated/prisma/client';
@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) { super(); }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }); }
}

// ✅ Đúng — service inject PORT
import { type User, UserRepository } from '../repositories/user.repository';
@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}
}

// ✅ Đúng — module wiring
{ provide: UserRepository, useClass: PrismaUserRepository }

// ❌ Sai — service inject PrismaService trực tiếp
constructor(private readonly prisma: PrismaService) {}
```

Lỗi Prisma được xử lý trong Prisma impl qua `Prisma.PrismaClientKnownRequestError`:
- `P2002`: unique constraint
- `P2025`: record not found
- `P2003`: foreign key constraint

Multi-step writes dùng `prisma.$transaction([...])` hoặc `$transaction(async (tx) => …)` bên trong Prisma impl.

### 8. Date/Time — Temporal API

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

### 9. Testing (Jest)

- ✅ File `*.spec.ts` **đặt cùng thư mục** với source (colocated), không đặt trong `__tests__/`
  - Service spec đặt trong `services/`: `services/<feature>.service.spec.ts`
- ✅ Mock = plain object + `useValue` trong `Test.createTestingModule`
- ✅ Mock **repository PORT** (không mock `PrismaService`) trong test service
- ✅ `jest.clearAllMocks()` trong `beforeEach`
- ✅ Tên test mô tả **hành vi** — không bắt buộc "should … when …"
- ✅ Assert cụ thể: `toHaveBeenCalledWith`, `rejects.toBeInstanceOf`, `rejects.toMatchObject({ status: 404 })`
- ❌ Không dùng `jest.mock` ở top-level module
- ❌ Không bắt buộc comment `// Arrange / Act / Assert`
- ❌ Không đặt spec file trong `__tests__/`

```ts
// ✅ Đúng — mock repository PORT
describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: UserRepository, useValue: repo },
      ],
    }).compile();
    service = module.get(UsersService);
  });

  it('ném NotFoundException khi không tìm thấy user', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('999')).rejects.toBeInstanceOf(NotFoundException);
  });
});
```

---

## Output Format (Active mode)

### Danh sách vi phạm (mặc định)

```
src/modules/users/services/users.service.ts:42 — Dùng `new Date()` cho date logic → Thay bằng `Temporal.Now.instant()`
src/modules/users/dto/create-user.dto.ts:8 — `z.string().email()` (Zod 3 style) → Dùng `z.email()` (Zod 4)
src/modules/auth/services/auth.service.ts:15 — `z.date()` trong response DTO sẽ crash bootstrap → Dùng `z.any().transform(...)`
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
- Inject `PrismaService` trực tiếp vào service — phải qua repository port
- Cấu trúc phẳng (flat) bỏ qua subfolder — luôn dùng feature-first layout với `controllers/`, `services/`, `repositories/`, `dto/`
