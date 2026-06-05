# /review-code — Đánh giá chất lượng code (NestJS 11 + Fastify + Prisma 7)

## Tham số

`$ARGUMENTS` có thể là:
- Đường dẫn cụ thể (file hoặc thư mục)
- `all` — toàn bộ source
- `--changed` — file thay đổi so với nhánh gốc
- `--dirty` — file chưa commit + untracked
- `--staged` — file đã `git add`
- `--fix` — tự động sửa các lỗi an toàn, sau đó chạy `pnpm check`
- `--summary` — chỉ in phần TÓM TẮT

## Xác định phạm vi (scope)

```bash
BASE=$(git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's@^origin/@@')
[ -z "$BASE" ] && git rev-parse --verify -q main >/dev/null && BASE=main
[ -z "$BASE" ] && git rev-parse --verify -q master >/dev/null && BASE=master
```

- `--changed` → `git diff --name-only $BASE...HEAD`
- `--dirty` → hợp (union) của `git diff --name-only HEAD` và `git ls-files --others --exclude-standard`
- `--staged` → `git diff --name-only --cached`
- Luôn loại trừ `src/generated/`. Chỉ xét file `.ts`.

---

## Tiêu chí đánh giá

Với mỗi tiêu chí, ghi kết quả: **PASS** / **WARN** / **FAIL** kèm vị trí cụ thể `file:dòng — vấn đề → cách sửa`.

Dự án này là **single-tenant**. Không có gì để đánh giá về schema multi-tenant, không có migration kiểu ORM cũ. Bỏ qua hoàn toàn các khái niệm không áp dụng cho stack này.

---

### 1. Tính đúng đắn (Correctness)

Kiểm tra:
- Logic khớp với ý định: không suy luận sai điều kiện, không đảo chiều boolean
- Xử lý `null` từ `prisma.findUnique` (kiểm tra trước khi dùng)
- Mảng rỗng không gây lỗi runtime
- Phân trang không bị off-by-one (`skip = (page - 1) * limit`)
- `await` đầy đủ cho mọi Promise

Ví dụ lỗi:
```ts
// FAIL: thiếu await
const user = prisma.user.findUnique({ where: { id } });
// → thêm await
```

---

### 2. Bảo mật (Security)

Kiểm tra:
- Auth là **opt-out**: `JwtAuthGuard` global bảo vệ mọi route. Chỉ dùng `@Public()` (từ `src/common/decorators/public.decorator.ts`) cho endpoint thực sự công khai.
- **WARN/FAIL** nếu `@Public()` được đặt trên endpoint nhạy cảm (thay đổi mật khẩu, admin action, v.v.)
- Ẩn dữ liệu nhạy cảm (ví dụ `password`) được xử lý **chủ yếu** qua `@ZodSerializerDto(<Feature>ResponseDto)` — response schema của DTO loại bỏ các trường nhạy cảm. Trả về entity Prisma đầy đủ là **chấp nhận được** khi DTO response đã lọc đúng.
- `select` trong Prisma là biện pháp bảo vệ **khuyến nghị** (defense-in-depth, không bắt buộc) — không mandate `select` nếu `@ZodSerializerDto` đã xử lý.
- Không hardcode secret: dùng `ConfigService`, không đặt giá trị thật vào source code.

Ví dụ lỗi:
```ts
// FAIL: @Public() trên endpoint đổi mật khẩu
@Public()
@Patch('change-password')
```

---

### 3. Xử lý lỗi (Error Handling)

Kiểm tra:
- Service ném NestJS exceptions (`NotFoundException`, `BadRequestException`, `ConflictException`, ...)
- Controller **không** try/catch rồi nuốt lỗi im lặng
- Lỗi Prisma xử lý qua `Prisma.PrismaClientKnownRequestError` với đúng mã:
  - `P2002` → unique constraint vi phạm → `ConflictException`
  - `P2025` → record not found → `NotFoundException`
  - `P2003` → foreign key constraint → `BadRequestException`

Ví dụ lỗi:
```ts
// FAIL: không xử lý PrismaClientKnownRequestError
catch (e) {
  throw new InternalServerErrorException();
}
// → phân loại theo e.code (P2002, P2025, P2003)
```

---

### 4. Toàn vẹn dữ liệu (Data Integrity)

Kiểm tra:
- Chuỗi write nhiều bước phải bọc trong `prisma.$transaction`
- Ràng buộc unique được đảm bảo ở tầng DB (schema Prisma)
- Không để trạng thái trung gian nếu một bước thất bại

Ví dụ lỗi:
```ts
// FAIL: hai write riêng lẻ không có transaction
await prisma.order.create({ ... });
await prisma.inventory.update({ ... });
// → bọc trong prisma.$transaction([...])
```

---

### 5. Hiệu năng (Performance)

Kiểm tra:
- Không N+1: dùng `include` hoặc `select` thay vì lặp query trong vòng lặp
- Endpoint list có phân trang (`take` + `skip` hoặc cursor)
- Không fetch toàn bộ bảng lớn vào bộ nhớ

Ví dụ lỗi:
```ts
// FAIL: N+1
for (const post of posts) {
  post.author = await prisma.user.findUnique({ where: { id: post.authorId } });
}
// → dùng prisma.post.findMany({ include: { author: true } })
```

---

### 6. Chất lượng truy vấn Prisma (Prisma & Query Quality)

Kiểm tra:
- Mã lỗi Prisma được xử lý đúng (xem tiêu chí 3)
- Transaction scope **không** bao gồm lời gọi HTTP bên ngoài hoặc job queue — chỉ bao gồm các thao tác DB
- `select` là **khuyến nghị** (không bắt buộc / không mandate) — không FAIL vì thiếu `select` nếu DTO đã xử lý

Ví dụ lỗi:
```ts
// FAIL: gọi HTTP ngoài nằm trong transaction
await prisma.$transaction(async (tx) => {
  await tx.order.create({ ... });
  await httpService.post('/notify', { ... }); // sai
});
```

---

### 7. Thiết kế API (API Design)

Kiểm tra:
- REST conventions: `POST /resource` → 201, `GET /resource/:id` → 200, `DELETE` → 200 hoặc 204
- Swagger đầy đủ: `@ApiTags`, `@ApiBearerAuth`, `@ApiOkResponse` hoặc `@ApiCreatedResponse`, `@ZodSerializerDto`
- Không để controller trả về raw entity khi chưa có DTO response

Ví dụ lỗi:
```ts
// WARN: thiếu @ApiCreatedResponse
@Post()
create(@Body() dto: CreateUserDto) { ... }
// → thêm @ApiCreatedResponse({ type: UserResponseDto })
```

---

### 8. Khả năng đọc (Readability)

Kiểm tra:
- Tên biến/hàm rõ nghĩa, không viết tắt khó hiểu
- Hàm nhỏ, đơn trách nhiệm
- Không có magic number (dùng hằng số có tên)
- Không có code chết (dead code, import thừa)

Ví dụ lỗi:
```ts
// WARN: magic number
if (users.length > 100) { ... }
// → const MAX_BATCH_SIZE = 100;
```

---

### 9. Kiểm thử (Testing)

Kiểm tra:
- File `*.spec.ts` đặt cùng thư mục với file được test (colocated)
- Mock dùng plain object `useValue` (không dùng `jest.mock` module-level khi không cần)
- Có `jest.clearAllMocks()` trong `beforeEach` hoặc `afterEach`
- Assertion cụ thể (không chỉ `expect(result).toBeDefined()`)
- Tên test mô tả hành vi, không bắt buộc phải theo dạng `should … when …`

Ví dụ lỗi:
```ts
// WARN: assertion quá chung
expect(result).toBeDefined();
// → expect(result.id).toBe(mockUser.id);
```

---

### 10. Kiến trúc & phân tầng (Architecture)

Kiểm tra việc tuân thủ kiến trúc feature-first và repository port pattern:

- **`common/` vs `core/`**: cross-cutting concerns (decorators, filters, guards, interceptors) thuộc `src/common/`; infrastructure (config, prisma, queue, messaging, health) thuộc `src/core/`. FAIL nếu đặt nhầm tầng.
- **Service không được gọi `this.prisma.*` trực tiếp** và không được import từ `generated/prisma` — FAIL nếu vi phạm.
- **Chỉ `prisma-<feature>.repository.ts`** được import `PrismaService` và `generated/prisma` — FAIL nếu service hay controller làm vậy.
- **Wiring port ↔ impl tồn tại** trong module: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }` — FAIL nếu thiếu, vì NestJS sẽ không resolve được dependency.
- **Service inject PORT** (abstract class), không inject impl trực tiếp — WARN nếu inject impl.
- Cấu trúc thư mục đúng: `controllers/`, `services/`, `repositories/`, `dto/` — WARN nếu files nằm phẳng ở root module.

Ví dụ lỗi:
```ts
// FAIL: service import PrismaService trực tiếp
import { PrismaService } from '../../../core/prisma/prisma.service';
constructor(private readonly prisma: PrismaService) {}
// → Tạo repository port + impl; service chỉ inject PORT

// FAIL: thiếu wiring trong module
providers: [ProductsService, PrismaProductRepository]
// → providers: [ProductsService, { provide: ProductRepository, useClass: PrismaProductRepository }]
```

---

### 11. Quy ước dự án (Conventions)

Nhường cho lệnh `/coding-convention` để kiểm tra đầy đủ checklist convention. Ở đây chỉ cần kiểm tra:
- Biome format/lint (chạy `pnpm check` hoặc `pnpm lint`)
- Relative imports (không dùng alias `@app/*`)
- Không dùng `any` trừ khi có comment giải thích

---

## Định dạng kết quả

Với mỗi tiêu chí:

```
### [Số]. Tên tiêu chí — PASS | WARN | FAIL
- src/modules/user/user.service.ts:42 — vấn đề cụ thể → cách sửa
```

---

## TÓM TẮT (SUMMARY)

```
CRITICAL: X vấn đề
HIGH:     X vấn đề
MEDIUM:   X vấn đề
LOW:      X vấn đề

TOP 3 ưu tiên:
1. [CRITICAL/HIGH] file:dòng — mô tả ngắn
2. ...
3. ...
```

Mức độ nghiêm trọng:
- **CRITICAL** — lỗ hổng bảo mật, mất dữ liệu tiềm ẩn, crash không xử lý
- **HIGH** — logic sai, lỗi không được bắt đúng, N+1 nghiêm trọng
- **MEDIUM** — thiếu validation, thiếu Swagger, thiếu test coverage
- **LOW** — readability, convention nhỏ

---

## Cờ đặc biệt

- `--fix`: Tự động sửa các vấn đề an toàn (format, import thừa, annotation Swagger thiếu rõ ràng). Sau đó chạy `pnpm check` và báo cáo kết quả.
- `--summary`: Chỉ in phần TÓM TẮT, bỏ qua phần chi tiết từng tiêu chí.
