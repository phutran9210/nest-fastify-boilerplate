# nest-fastify — CLAUDE.md

Tài liệu ngắn gọn cho Claude. Đọc kỹ trước khi sinh code.

---

## Stack

| Layer | Thư viện / Công cụ |
|---|---|
| Framework | NestJS 11 + Fastify (`@nestjs/platform-fastify`) |
| ORM | Prisma 7 — generator `prisma-client` (ESM), client tại `src/generated/prisma`, import từ `src/generated/prisma/client`, driver adapter `@prisma/adapter-pg` |
| Validation / Serialization | nestjs-zod + Zod 4 — global `ZodValidationPipe` + `ZodSerializerInterceptor` |
| Auth | passport-jwt, global `JwtAuthGuard` |
| Queue / Messaging | BullMQ (`@nestjs/bullmq`), RabbitMQ microservice (`@nestjs/microservices`) |
| Ngày giờ | `@js-temporal/polyfill` (Temporal API) |
| Tooling | Biome (lint + format), Jest, pnpm |
| API Docs | Swagger UI tại `/docs` — xây bằng `cleanupOpenApiDoc` từ nestjs-zod |

---

## Lệnh chính (pnpm — KHÔNG dùng npm/yarn)

```bash
pnpm start:dev        # Khởi động dev server
pnpm test             # Chạy toàn bộ Jest tests
pnpm check            # Biome format + lint --write
pnpm lint             # Biome lint (không ghi)
pnpm prisma:migrate   # Chạy Prisma migrations
pnpm prisma:generate  # Sinh Prisma client
```

---

## Convention cốt lõi

### `any` — DUOC PHEP (noExplicitAny off)
- Biome tắt `noExplicitAny` — dùng `any` khi cần.
- Response DTO được phép và thường xuyên dùng `z.any()`.
- `useImportType` cũng tắt — KHONG bat buoc `import type`.

### Auth opt-out — `@Public()` de mo endpoint
- Global `JwtAuthGuard` bao ve MOI route mac dinh.
- De lo route cong khai: gan decorator `@Public()` (tu `src/core/decorators/public.decorator.ts`).
- Controller can xac thuc: them `@ApiBearerAuth()`.

### Date trong response DTO — KHONG dung `z.date()`
- `z.date()` lam `z.toJSONSchema()` (nestjs-zod dung cho Swagger) bi crash — **app khong boot**.
- Thay the bang:
  ```ts
  z.any().transform((v) => v instanceof Date ? v.toISOString() : String(v))
  ```
- Day la pattern bat buoc cho moi field kieu Date trong response DTO.

### Logic ngay thang dung Temporal
- Import: `import { Temporal, toTemporalInstant } from '@js-temporal/polyfill'`
- Chuyen Prisma `Date` sang Temporal: `toTemporalInstant.call(date)` (KHONG phai `date.toTemporalInstant()`).
- Tranh dung `new Date()` cho logic nghiep vu.

### Import va cau truc module
- Dung **relative imports** — khong co path alias trong thuc te.
- Cau truc phang: `src/modules/<feature>/<feature>.controller.ts`, `<feature>.service.ts`, v.v.
- Khong tao subfolder `controllers/` hay `services/`; khong tao barrel `index.ts`.

### PrismaService
- Inject `PrismaService` truc tiep.
- Khi khong tim thay ban ghi: `throw new NotFoundException(\`X ${id} not found\`)` (template literal).
- Xu ly Prisma error qua `Prisma.PrismaClientKnownRequestError` — codes: `P2002` (unique), `P2025` (not found), `P2003` (foreign key).

### Tests
- File `*.spec.ts` dat CUNG THU MUC voi source (khong dung `__tests__/`).
- Mock bang plain object `useValue` — khong dung `jest.createMockFromModule`.
- Goi `jest.clearAllMocks()` trong `beforeEach`.

---

## Slash commands (`.claude/commands/`)

| Command | Mo ta |
|---|---|
| `/coding-convention` | Quy uoc code — xem thu dong (passive) hoac quet va sua (`--fix`) |
| `/review-code` | Review chat luong theo 10 tieu chi |
| `/create-module` | Sinh feature module phang day du (Prisma + nestjs-zod) |
| `/create-dto` | Sinh Zod DTO: create / update / response / query |
| `/create-test` | Sinh Jest spec colocated ben canh source |
| `/create-tdd` | Workflow red-green-refactor co huong dan |
