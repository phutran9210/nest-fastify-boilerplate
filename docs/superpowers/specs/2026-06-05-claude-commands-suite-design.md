# Design: Bộ slash commands `.claude/commands/` cho nest-fastify

**Ngày:** 2026-06-05
**Trạng thái:** Đã chốt design, chờ review spec

## 1. Mục tiêu

Port bộ lệnh tham chiếu từ `/home/phuth/Desktop/mkt-crm-2026/.claude/commands` (dự án CRM dùng
TypeORM + class-validator + dayjs + multi-tenant) sang dự án `nest-fastify`, **adapt đúng stack thật**:
NestJS 11 + Fastify + Prisma 7 + nestjs-zod + Zod 4 + Temporal + Biome, single-tenant, cấu trúc phẳng.

Phong cách: **bám sát code hiện tại** (module `users` tối giản), KHÔNG áp các convention giàu hơn của
CRM (barrel export, MESSAGES constants, constraints constants, multi-tenant repository).

## 2. Phạm vi

Tạo **6 slash commands** + **1 CLAUDE.md**. KHÔNG port: entity (Prisma dùng `schema.prisma`), seeder,
guard, swagger, bdd, br, sd, impl, api-test-case, guideline-writer, test-spec.

| File | Vai trò |
|------|---------|
| `.claude/commands/coding-convention.md` | Guideline passive + scan/fix active |
| `.claude/commands/review-code.md` | Review chất lượng theo tiêu chí |
| `.claude/commands/create/module.md` | Sinh feature module phẳng |
| `.claude/commands/create/dto.md` | Sinh zod DTO |
| `.claude/commands/create/test.md` | Sinh Jest `*.spec.ts` colocated |
| `.claude/commands/create/tdd.md` | Workflow red-green-refactor |
| `CLAUDE.md` (root) | Tóm tắt stack + convention, auto-load mỗi session |

Các command surface dưới dạng `/coding-convention`, `/review-code`, `/create:module`, `/create:dto`,
`/create:test`, `/create:tdd`. Tất cả viết tiếng Việt, có example code đúng stack. Commit vào repo.

## 3. Sự thật về stack (đã verify trong code + Context7)

Các quy ước dưới đây là nguồn chân lý cho mọi command. Chúng **khác** bản CRM:

### 3.1 TypeScript / Biome (`biome.json` 2.4.16)
- `any` **ĐƯỢC PHÉP** (`noExplicitAny: "off"`) — response DTO cố ý dùng `z.any()`. KHÔNG cấm `any`.
- `import type` **KHÔNG bắt buộc** (`useImportType: "off"`).
- Single quotes, trailing comma `all`, semicolons `always`, indent 2 spaces, lineWidth 100.
- `src/generated` bị Biome ignore.
- Lệnh format/lint: `pnpm check` (= `biome check --write .`), `pnpm lint` (= `biome check .`).

### 3.2 Import & cấu trúc
- **Relative imports** trong thực tế (vd `../../core/prisma/prisma.service`). Alias `@app/*` tồn tại
  trong tsconfig nhưng code hiện không dùng — command KHÔNG ép dùng alias.
- Cấu trúc **phẳng**: `src/modules/<feature>/<feature>.controller.ts`, `.service.ts`, `.module.ts`,
  `dto/`. KHÔNG có `controllers/`, `services/`, `repositories/` subfolder. KHÔNG barrel `index.ts`.
- Prisma client import từ `../../generated/prisma/client` (generator `prisma-client`, ESM, output
  `src/generated/prisma`). Types: `import type { Prisma, User } from '../../generated/prisma/client'`.

### 3.3 nestjs-zod (wiring global trong `app.module.ts`)
- `ZodValidationPipe` (`APP_PIPE`) + `ZodSerializerInterceptor` (`APP_INTERCEPTOR`) global.
- `main.ts` dùng `cleanupOpenApiDoc(openApiDoc)` cho Swagger (mount tại `/docs`).
- DTO pattern thật của project (giữ nguyên, KHÔNG "đơn giản hóa"):
  ```ts
  export const createUserSchema = z.object({ email: z.email(), password: z.string().min(8) });
  export class CreateUserDto extends (createZodDto(createUserSchema) as ReturnType<
    typeof createZodDto<typeof createUserSchema>
  >) {}
  ```
- Controller dùng `@ZodSerializerDto(Dto)` (array: `@ZodSerializerDto([Dto])` hoặc service trả mảng).
- **Caveat date trong response DTO** (BẮT BUỘC, có comment cảnh báo trong code):
  `z.date()` làm crash `z.toJSONSchema()` mà nestjs-zod gọi để dựng Swagger → dùng
  `z.any().transform((v) => v instanceof Date ? v.toISOString() : String(v))` cho field ngày.
- Zod 4: dùng `z.email()` top-level (KHÔNG `z.string().email()`).

### 3.4 Auth (opt-out)
- `JwtAuthGuard` là **global** (`APP_GUARD`). Endpoint mặc định **được bảo vệ**.
- Để mở public: `@Public()` từ `src/core/decorators/public.decorator.ts`.
- Controller cần bảo vệ thêm `@ApiBearerAuth()` cho Swagger.
- `JwtAuthGuard` đã skip non-HTTP context (RMQ consumer) — đừng đụng.

### 3.5 Prisma 7
- Service inject `PrismaService` (extends `PrismaClient`). KHÔNG repository riêng.
- Find-one không thấy → `throw new NotFoundException(\`<Entity> ${id} not found\`)` (template literal,
  KHÔNG MESSAGES constant).
- Error handling: `Prisma.PrismaClientKnownRequestError` + `code`:
  `P2002` unique, `P2025` not found, `P2003` FK. (kiểm tra qua `instanceof Prisma.PrismaClientKnownRequestError`).
- Multi-step → `prisma.$transaction([...])` hoặc interactive `$transaction(async (tx) => …)`.
- N+1: dùng `include`/`select` thay vì loop query. `select` để tránh trả field nhạy cảm (vd `password`).

### 3.6 Date/time
- Logic ngày giờ: `import { Temporal } from '@js-temporal/polyfill'` (đã là dependency).
  `Temporal.Now.instant()`, `Temporal.Now.zonedDateTimeISO(tz)`, `Temporal.PlainDate.from(...)`,
  arithmetic bất biến (`.add({days:1})`), so sánh `Temporal.X.compare(a,b)`, serialize `.toString()`.
- Convert từ `Date` của Prisma: `toTemporalInstant.call(date)` hoặc `date.toTemporalInstant()`.
- Ngoại lệ: cột `DateTime` của Prisma vẫn là `Date` JS — chỉ chuyển sang Temporal khi cần tính toán.

### 3.7 Testing
- Jest. File `*.spec.ts` **colocated** cạnh source (vd `users.service.spec.ts`), KHÔNG `__tests__/`.
- Mock = **plain object + `useValue`** trong `Test.createTestingModule`, KHÔNG `jest.mock` module.
- `beforeEach`: `jest.clearAllMocks()` rồi compile module.
- Tên test **mô tả hành vi** (vd `'findOne throws NotFoundException when the user does not exist'`).
  KHÔNG ép format `should … when …`, KHÔNG ép comment `// Arrange/Act/Assert` (code hiện tại không có).
- Assert cụ thể: `toHaveBeenCalledWith(...)`, `toBe`, `toEqual`, `rejects.toBeInstanceOf(...)`,
  `rejects.toMatchObject({ status: 404 })`.

### 3.8 Git
- Commit convention: `<type>(<scope>): <subject>` (feat/fix/refactor/docs/test/chore/perf).
- Branch default cho diff: `main`.

## 4. Thiết kế từng command

### 4.1 `coding-convention.md`
2 chế độ như reference:
- **Passive** (không `$ARGUMENTS`): guideline tham chiếu khi viết/review — nội dung mục 3 ở trên,
  trình bày dạng checklist + example đúng/sai theo stack thật.
- **Active** (`$ARGUMENTS` = path / `all` / `--changed` / `--dirty` / `--staged`, + `--fix` / `--summary`):
  scan `.ts` files, liệt kê vi phạm `file:line — vi phạm → cách fix`, auto-fix khi `--fix`.
- Scope flags so với `main`: `--changed` = `git diff --name-only main...HEAD`; `--dirty` =
  `git diff --name-only HEAD`; `--staged` = `git diff --name-only --cached`.
- Checklist adapt: bỏ rule "no any", "import type", "no .js extension đã đúng", dayjs→Temporal,
  TypeORM→Prisma, class-validator→zod, thêm rule auth opt-out + date caveat + Prisma error codes.
- Nhắc chạy `pnpm check` sau khi fix.

### 4.2 `review-code.md`
Tiêu chí review (rút gọn từ 11 của CRM cho hợp single-tenant Prisma):
1. Correctness, 2. Security (auth opt-out: kiểm tra `@Public()` không bị lạm dụng; secret stripping qua
   `ZodSerializerDto` dùng `select`), 3. Error handling (Prisma codes, NotFoundException, không
   try/catch nuốt lỗi trong controller), 4. Data integrity (`$transaction` cho multi-step, unique ở DB),
5. Performance (N+1 qua `include`/`select`, pagination, `select` thay vì lấy hết cột),
6. Prisma & query quality (codes, transaction scope không bọc external call, `select` để khỏi leak),
7. API design (REST, status code, Swagger qua nestjs-zod), 8. Readability, 9. Testing (style mục 3.7),
10. Conventions (link sang coding-convention).
**Bỏ** hẳn: multi-tenant SQL, TypeORM migration safety, raw QueryBuilder.
Cùng scope flags + `--fix`/`--summary` như coding-convention. Output dạng bảng PASS/WARN/FAIL +
summary CRITICAL/HIGH/MEDIUM/LOW + top 3 priorities.

### 4.3 `create/module.md`
`$ARGUMENTS` = tên module (vd `product`). Sinh, theo đúng style `users`:
```
src/modules/<feature>/
├── <feature>.module.ts
├── <feature>.controller.ts        # @ApiTags + @ApiBearerAuth, @ZodSerializerDto, CRUD
├── <feature>.service.ts           # inject PrismaService, NotFoundException template literal
├── <feature>.service.spec.ts      # theo create/test
└── dto/
    ├── create-<feature>.dto.ts
    ├── update-<feature>.dto.ts     # partial của create schema
    └── <feature>-response.dto.ts   # có date caveat
```
Cuối cùng: **đăng ký module vào `src/app.module.ts`** (`imports`). Nhắc thêm model vào
`prisma/schema.prisma` + chạy `pnpm prisma:migrate` & `pnpm prisma:generate` (command KHÔNG tự sửa schema —
chỉ hướng dẫn, vì model fields do người dùng quyết định).

### 4.4 `create/dto.md`
`$ARGUMENTS` = tên + loại (create/update/response/query). Sinh DTO đúng pattern `createZodDto(...) as
ReturnType<...>`, Zod 4 idioms, update = `schema.partial()`, response kèm date caveat. Query DTO (nếu cần
phân trang) dùng `z.coerce.number()` cho `page`/`limit`.

### 4.5 `create/test.md`
`$ARGUMENTS` = path service/controller. Sinh `*.spec.ts` colocated theo style mục 3.7: plain-object mock
+ `useValue`, `jest.clearAllMocks()`, tên test mô tả hành vi, assert cụ thể. Có ví dụ mock `PrismaService`
(`{ user: { findUnique: jest.fn(), … } }`) và mock service phụ thuộc.

### 4.6 `create/tdd.md`
Workflow: (1) viết test đỏ trước theo `create/test`, (2) chạy `pnpm test` xác nhận đỏ, (3) code tối thiểu
cho xanh, (4) refactor, (5) chạy `pnpm check`. Tham chiếu conventions, nhấn mạnh không viết code trước test.

### 4.7 `CLAUDE.md` (root)
Bản tóm tắt ngắn (~1 trang): stack, lệnh chính (`pnpm start:dev`, `test`, `check`, `prisma:*`), và các
convention cốt lõi mục 3 (đặc biệt: any được phép, auth opt-out, date caveat, Temporal, relative import,
flat structure). Trỏ tới các slash command để dùng sâu hơn.

## 5. Ngoài phạm vi (YAGNI)
- Không tạo barrel export, MESSAGES/constraints constants, custom swagger decorator files.
- Không port entity/seeder/guard/bdd/sd/br/impl/api-test-case/test-spec/guideline-writer.
- Không sửa code nguồn hiện có (chỉ thêm commands + CLAUDE.md).
- Không tự sửa `prisma/schema.prisma`.

## 6. Tiêu chí hoàn thành
- 6 file command + CLAUDE.md tồn tại, nội dung khớp mục 3–4, tiếng Việt, example compile-được về mặt cú pháp.
- Không command nào còn dấu vết CRM (TypeORM, dayjs, class-validator, multi-tenant, barrel export, MESSAGES).
- Commit sạch trên branch hiện tại.
