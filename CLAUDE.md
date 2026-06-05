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
- De lo route cong khai: gan decorator `@Public()` (tu `src/common/decorators/public.decorator.ts`).
- Controller can xac thuc: `ApiBearerAuth()` dat BEN TRONG composite decorator cua module (xem muc Swagger ben duoi), KHONG dat truc tiep tren controller.

### Swagger — gom tap trung trong `decorators/`
- MOI controller co file `<module>/decorators/<feature>-api.decorator.ts` chua toan bo metadata Swagger duoi dang composite `applyDecorators`.
- Class-level: `Api<Feature>Controller()` — gom `ApiTags` + `ApiStandardErrorResponses` (+ `ApiBearerAuth` neu can auth).
- Per-endpoint: `Api<Action>()` — gom `ApiEnvelopeResponse(...)` va metadata rieng cua route.
- Controller **KHONG** import truc tiep tu `@nestjs/swagger` — chi import cac `Api*()` tu `decorators/`.
- Ap dung cho MOI controller, ke ca route chi co `ApiTags` (mail, notifications, health…).
- Module tham chieu: `src/modules/users/decorators/users-api.decorator.ts`.

### HTTP status — `@HttpCode` tuong minh, dung `HttpStatus` cua `@nestjs/common`
- MOI route HTTP **bat buoc** khai bao `@HttpCode(HttpStatus.X)` tuong minh — KHONG dua vao mac dinh ngam cua Nest (POST→201, con lai→200).
- `status` trong `ApiEnvelopeResponse(..., { status: HttpStatus.X })` phai dung **cung** `HttpStatus.X` voi `@HttpCode` → runtime va Swagger luon dong bo.
- KHONG dung so magic (`201`, `202`…) — luon dung enum `HttpStatus` (`CREATED`, `OK`, `ACCEPTED`, `NO_CONTENT`…).
- Quy uoc status: tao resource → `CREATED` (201); doc/sua/xoa tra body → `OK` (200); hanh dong bat dong bo (enqueue/publish) → `ACCEPTED` (202).

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

### Cau truc du an — feature-first, co phan tang ro rang

```
src/
├── common/          # cross-cutting concerns
│   ├── decorators/  # @Public(), v.v.
│   ├── filters/     # HttpExceptionFilter
│   ├── guards/      # JwtAuthGuard
│   └── interceptors/
├── core/            # infrastructure (khong co business logic)
│   ├── config/      # Zod-validated env
│   ├── prisma/      # PrismaService (@Global)
│   ├── queue/       # BullMQ root
│   ├── messaging/   # RabbitMQ client
│   └── health/      # GET /health
└── modules/         # business features
    ├── users/
    │   ├── users.module.ts
    │   ├── controllers/
    │   ├── decorators/    # Swagger gom tap trung — composite @Api*()
    │   ├── services/      # *.service.ts + *.service.spec.ts
    │   ├── repositories/  # *.repository.port.ts (PORT) + *.repository.prisma.ts (IMPL)
    │   └── dto/
    ├── auth/
    ├── mail/
    └── notifications/     # RabbitMQ consumer (truoc day: messaging/consumer)
```

- **Path alias cho import vuot cap (khac module/layer)** — khai bao o `tsconfig.json` (`paths`), `.swcrc` (`jsc.baseUrl` + `jsc.paths`) va `jest.config.js` (`moduleNameMapper`):
  - `@common/*` → `src/common/*`
  - `@core/*` → `src/core/*`
  - `@modules/*` → `src/modules/*`
  - `@generated/*` → `src/generated/*`
  - Dung alias khi import vuot ra ngoai module/layer hien tai (truoc day la `../../../`). Vi du: `@common/decorators/public.decorator`, `@modules/users/dto/user-response.dto`, `@generated/prisma/client`.
  - **Import trong cung module** (cung folder `<feature>/`) van dung relative ngan (`./`, `../dto/`, `../services/`) — KHONG alias hoa.
  - SWC rewrite alias → relative luc build (xem `dist/`), nen runtime khong can `tsconfig-paths`.
- Khong tao file barrel `index.ts`.
- Module file (`<feature>.module.ts`) nam thang trong `src/modules/<feature>/`.

### Repository port pattern — data access

- **Service inject PORT** (`abstract class <Feature>Repository`) — KHONG inject `PrismaService` truc tiep.
- **Naming theo vai tro (suffix):** PORT = `<feature>.repository.port.ts`, IMPL = `<feature>.repository.prisma.ts` — nhin duoi file la biet vai tro. Doi adapter khac → `<feature>.repository.<adapter>.ts` (vd `.mongo.ts`).
- **PORT** (`repositories/<feature>.repository.port.ts`): `abstract class` dong vai tro TS type VA DI token; re-export model type qua `export type { <Model> }`; dinh nghia `Create<F>Data` / `Update<F>Data`.
- **Prisma impl** (`repositories/<feature>.repository.prisma.ts`): file DUY NHAT import `PrismaService` va `generated/prisma`.
- **Module wiring**: `{ provide: <Feature>Repository, useClass: Prisma<Feature>Repository }`.
- Service import kieu model TU PORT, khong import tu `generated/prisma` truc tiep.

Xem `src/modules/users/` la module tham chieu chinh xac nhat.

### Tests
- File `*.spec.ts` dat CUNG THU MUC voi source (khong dung `__tests__/`).
  - Service spec dat trong `services/`: `services/<feature>.service.spec.ts`.
- Mock **repository PORT** bang plain object `useValue` — khong mock `PrismaService`.
- Goi `jest.clearAllMocks()` trong `beforeEach`.

---

## Slash commands (`.claude/commands/`)

| Command | Mo ta |
|---|---|
| `/coding-convention` | Quy uoc code — xem thu dong (passive) hoac quet va sua (`--fix`) |
| `/review-code` | Review chat luong theo 11 tieu chi (co tieu chi kien truc) |
| `/create-module` | Sinh feature module feature-first day du (repository port + Prisma impl + nestjs-zod) |
| `/create-dto` | Sinh Zod DTO: create / update / response / query |
| `/create-test` | Sinh Jest spec colocated ben canh source (mock repository PORT) |
| `/create-tdd` | Workflow red-green-refactor co huong dan |
