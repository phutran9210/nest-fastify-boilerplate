# Hệ thống Message Management (i18n) — Design

- **Ngày:** 2026-06-05
- **Trạng thái:** Approved, sẵn sàng lập kế hoạch implement
- **Stack liên quan:** NestJS 11 + Fastify, nestjs-zod, Pino, SWC builder, pnpm
- **Thư viện:** `nestjs-i18n@10.8.4`

## 1. Mục tiêu

Xây hệ thống quản lý message (text) tập trung cho toàn bộ ứng dụng:

- Catalog message đa ngôn ngữ (vi/en), **type-safe**.
- Mỗi module **sở hữu** một file message namespace riêng, **extend** catalog chung bằng cách thêm file. Package/library ngoài thêm message theo cùng cơ chế.
- Service ném exception mang **message KEY**; global filter dịch sang locale của request. Service không cần biết locale hiện tại.

### Non-goals (YAGNI)

- Không lưu message trong database / sửa runtime qua admin.
- Không gắn message thành công vào envelope response (chỉ làm chiều lỗi).
- Không dịch message của Zod validation (giữ nguyên hành vi hiện tại).
- Không thêm `SUPPORTED_LANGUAGES` whitelist trừ khi phát sinh nhu cầu chặn locale lạ.

## 2. Quyết định đã chốt

| Vấn đề | Quyết định |
|---|---|
| Loại message | Text response/error message (không phải event/queue message) |
| Đa ngôn ngữ | Có — i18n ngay từ đầu (vi + en) |
| Storage | File JSON |
| Cơ chế raise | Service ném exception mang message KEY; filter dịch |
| Bố cục file | **Central root `src/i18n/<lang>/<namespace>.json`, một file/module** |
| Thư viện | `nestjs-i18n@10.8.4` (`I18nJsonLoader`) |
| Sinh type | CLI `nestjs-i18n` (script `pnpm i18n:gen`) — không cần boot app/infra |

### Vì sao central thay vì colocated

Đã verify thực nghiệm với `nestjs-i18n@10.8.4`:

- **Runtime**: cả hai layout đều chạy (nhiều loader merge ổn).
- **Type generation**: CLI `nestjs-i18n -p <root> --include-subfolders` chỉ sinh key đúng khi `<root>` có thư mục ngôn ngữ là **con trực tiếp**. Với colocated (file rải rác mỗi module) CLI **không merge được**, sinh key rác (`i18n.en.common.NOT_FOUND`). Sinh type cho colocated phải boot app (cần DB/Redis/RabbitMQ) hoặc viết script gom thư mục tạm — nhiều mảnh ghép, kém tin cậy.
- Central giữ được "mỗi module một file namespace" (`users.json`, `auth.json`…) MÀ type-gen chỉ là một lệnh CLI, không cần infra.

## 3. Thư viện & wiring

- Thêm dependency `nestjs-i18n` (peer cần `class-validator`, `rxjs` — `rxjs` đã có).
- Module mới `src/core/i18n/i18n.module.ts`, đánh dấu `@Global()`, dùng `I18nModule.forRootAsync` để đọc env qua `ConfigService` (theo pattern `LoggerModule`):
  - **loaders**: một `I18nJsonLoader` với `path` trỏ vào `src/i18n` (sau build là `dist/src/i18n`). nestjs-i18n đọc các thư mục ngôn ngữ (`vi/`, `en/`) làm con trực tiếp; mỗi file `.json` là một namespace.
  - **resolvers** (thứ tự ưu tiên): `QueryResolver(['lang', 'l'])`, `HeaderResolver(['x-lang'])`, `AcceptLanguageResolver`.
  - **fallbackLanguage**: từ env `FALLBACK_LANGUAGE`.
- **Không** set `typesOutputPath` trong module (tránh ghi file lúc app chạy). Sinh type bằng CLI riêng (xem dưới).
- Import `CoreI18nModule` vào `AppModule`.

### Sinh type & file generated

- Script: `"i18n:gen": "nestjs-i18n -p src/i18n -o src/generated/i18n.generated.ts --include-subfolders"` và `"i18n:gen:watch": "nestjs-i18n -p src/i18n -o src/generated/i18n.generated.ts --include-subfolders --watch"`.
- File sinh ra: `src/generated/i18n.generated.ts`, export `I18nTranslations` và `I18nPath`.
- **Gitignore**: file nằm trong `/src/generated` (đã ignore sẵn, như prisma client) → **không commit**, regenerate bằng `pnpm i18n:gen` (giống `pnpm prisma:generate`).
- Wire vào `verify`: `"verify": "pnpm i18n:gen && pnpm check && pnpm typecheck && pnpm build"` để typecheck/build/CI luôn có type mới nhất. Dev sửa message → chạy `pnpm i18n:gen` (hoặc `:watch`).

## 4. Bố cục file message (central, một file/module)

Cấu trúc `src/i18n/<lang>/<namespace>.json` — ngôn ngữ là thư mục, namespace là tên file:

```
src/i18n/vi/common.json          # validation, lỗi HTTP chung, generic → key common.*
src/i18n/vi/users.json           # → key users.*
src/i18n/vi/auth.json            # → key auth.*
src/i18n/vi/mail.json            # → key mail.*
src/i18n/vi/notifications.json   # → key notifications.*
src/i18n/en/common.json
src/i18n/en/users.json
src/i18n/en/auth.json
src/i18n/en/mail.json
src/i18n/en/notifications.json
```

- "Extend" = thêm một file namespace mới vào `src/i18n/<lang>/`.
- Mỗi cặp vi/en phải đồng bộ key (CLI có `check` mode để kiểm khuyết key — tùy chọn dùng sau).

### Ví dụ nội dung

`src/i18n/vi/users.json`:
```json
{
  "NOT_FOUND": "Không tìm thấy người dùng",
  "EMAIL_TAKEN": "Email {email} đã được sử dụng"
}
```

`src/i18n/en/users.json`:
```json
{
  "NOT_FOUND": "User not found",
  "EMAIL_TAKEN": "Email {email} is already in use"
}
```

## 5. Exception mang KEY — `AppException`

File: `src/common/exceptions/app.exception.ts`

```ts
import { HttpException, HttpStatus } from '@nestjs/common';
import type { I18nPath } from '@generated/i18n.generated';

export class AppException extends HttpException {
  constructor(
    readonly messageKey: I18nPath,                   // typed — sai key là lỗi compile
    status: HttpStatus,
    readonly args?: Record<string, unknown>,         // nội suy {email}, {id}, ...
    readonly code?: string,                          // override code máy; mặc định suy từ status
  ) {
    super(messageKey, status);
  }
}
```

- Cách dùng trong service: `throw new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id })`.
- `I18nPath` (alias `Path<I18nTranslations>`) lấy từ file generated → autocomplete + bắt sai key lúc compile.

## 6. Luồng xử lý lỗi — sửa `HttpExceptionFilter`

File: `src/common/filters/http-exception.filter.ts`

- Inject thêm `I18nService<I18nTranslations>` (filter là `APP_FILTER` qua DI nên inject được).
- Khi `exception instanceof AppException`:
  - `lang = I18nContext.current()?.lang` (nestjs-i18n đã resolve locale từ request); không có → để nestjs-i18n tự fallback (`i18n.translate` không truyền `lang` thì dùng context/fallback).
  - `message = i18n.translate(exception.messageKey, { lang, args: exception.args })`.
  - `code = exception.code ?? codeFromStatus(status)`.
  - `status = exception.getStatus()`.
- `ZodSerializationException`, `ZodValidationException`, và `HttpException` thường: **giữ nguyên** hành vi hiện tại.
- Shape `ErrorResponse` (`success`/`error.code`/`error.message`/`error.details`/`meta`) **không đổi**.
- `AppException` phải được kiểm tra **trước** nhánh `HttpException` chung (vì nó kế thừa `HttpException`), tương tự cách `ZodValidationException` đang được kiểm tra trước.

## 7. Build — copy JSON sang dist

SWC builder không tự copy asset `.json`. Sửa `nest-cli.json`, thêm vào `compilerOptions`:

```json
"assets": [{ "include": "i18n/**/*", "watchAssets": true }],
"watchAssets": true
```

`include` tương đối với `sourceRoot` (`src`) → copy `src/i18n` sang `dist/src/i18n` giữ nguyên cấu trúc. Runtime loader trỏ `path.join(__dirname, '..', '..', 'i18n')` từ `dist/src/core/i18n` → `dist/src/i18n`.

## 8. Env — `src/core/config/env.schema.ts`

Thêm:

```ts
FALLBACK_LANGUAGE: z.string().default('vi'),
```

- `FALLBACK_LANGUAGE`: set vào `fallbackLanguage` của nestjs-i18n — dùng khi không resolver nào trả về ngôn ngữ, hoặc thiếu bản dịch cho locale yêu cầu.
- **Không** thêm `DEFAULT_LANGUAGE` riêng: `fallbackLanguage` đã phủ trường hợp "không xác định được locale" (YAGNI).

## 9. Phạm vi áp dụng (migration)

- **Hạ tầng đầy đủ**: `CoreI18nModule`, `AppException`, sửa filter, sửa build, sửa env, scripts type-gen.
- **File message**: tạo cho `common`, `users`, `auth`, `mail`, `notifications` (cả vi + en).
- **Migrate sang `AppException`**: `users` và `auth` (có lỗi nghiệp vụ thật) — làm module tham chiếu.
- `mail` / `notifications`: có file message sẵn, migrate sau khi phát sinh nhu cầu.

## 10. Kiểm thử

- `app.exception.spec.ts`: dựng đúng `status` / `messageKey` / `args` / `code`.
- `http-exception.filter.spec.ts`:
  - `AppException` → message được dịch đúng theo `lang` (vi và en) — mock `I18nService.translate`.
  - `HttpException` thường và Zod exceptions: giữ nguyên hành vi.
  - **Lưu ý:** constructor filter giờ nhận thêm `I18nService` → cập nhật `new HttpExceptionFilter(config, i18n)` trong toàn bộ spec hiện có.
- Cập nhật `users.service.spec.ts` / `auth.service.spec.ts` theo `AppException` (status vẫn 404/409/401; có thể assert `instanceof AppException` + `messageKey`).

## 11. Điểm cần verify khi implement (chạy thật)

- Tương thích `nestjs-i18n` + Fastify adapter: resolver đọc header/query qua middleware của lib — test request `?lang=en`, header `Accept-Language: en`, header `x-lang: en`.
- Path tương đối loader từ `dist/src/core/i18n` tới `dist/src/i18n` sau `pnpm build`.
- `I18nContext.current()` hoạt động trong filter (AsyncLocalStorage) dưới Fastify.
- `pnpm i18n:gen` sinh `I18nTranslations` chứa đủ namespace `common/users/auth/mail/notifications`.

## 12. Danh sách file thay đổi (tóm tắt)

**Mới:**
- `src/core/i18n/i18n.module.ts`
- `src/common/exceptions/app.exception.ts`
- `src/common/exceptions/app.exception.spec.ts`
- `src/i18n/{vi,en}/common.json`
- `src/i18n/{vi,en}/users.json`
- `src/i18n/{vi,en}/auth.json`
- `src/i18n/{vi,en}/mail.json`
- `src/i18n/{vi,en}/notifications.json`
- `src/generated/i18n.generated.ts` (generated, gitignored)

**Sửa:**
- `src/common/filters/http-exception.filter.ts` (+ spec — thêm I18nService)
- `src/app.module.ts` (import `CoreI18nModule`)
- `src/core/config/env.schema.ts` (`FALLBACK_LANGUAGE`)
- `nest-cli.json` (assets)
- `package.json` (dep `nestjs-i18n` + scripts `i18n:gen`, `i18n:gen:watch`, sửa `verify`)
- `src/modules/users/services/users.service.ts` (+ spec) — dùng `AppException`
- `src/modules/auth/services/auth.service.ts` (+ spec) — dùng `AppException`
