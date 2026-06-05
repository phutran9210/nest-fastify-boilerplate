# Hệ thống Message Management (i18n) — Design

- **Ngày:** 2026-06-05
- **Trạng thái:** Approved, sẵn sàng lập kế hoạch implement
- **Stack liên quan:** NestJS 11 + Fastify, nestjs-zod, Pino, SWC builder, pnpm

## 1. Mục tiêu

Xây hệ thống quản lý message (text) tập trung cho toàn bộ ứng dụng:

- Catalog message đa ngôn ngữ (vi/en), **type-safe**.
- Mỗi module **sở hữu** bộ message riêng (colocated trong module), **extend** catalog chung. Package/library ngoài có thể thêm message theo cùng cơ chế.
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
| Bố cục file | Colocated trong từng module (feature-first) |
| Thư viện | `nestjs-i18n` (`I18nJsonLoader`, watch mode) |

## 3. Thư viện & wiring

- Thêm dependency `nestjs-i18n`.
- Module mới `src/core/i18n/i18n.module.ts`, đánh dấu `@Global()`, dùng `I18nModule.forRootAsync` để đọc env qua `ConfigService`:
  - **loaders**: một `I18nJsonLoader` cho mỗi nguồn message — `common` + mỗi feature module (`users`, `auth`, `mail`, `notifications`). Thêm module/package mới = thêm một entry loader. **Đây là cơ chế "extend"**.
  - **resolvers** (thứ tự ưu tiên): `QueryResolver(['lang', 'l'])`, `HeaderResolver(['x-lang'])`, `AcceptLanguageResolver`.
  - **fallbackLanguage**: lấy từ env (`FALLBACK_LANGUAGE`).
  - **typesOutputPath**: `src/generated/i18n.generated.ts` (hợp path alias `@generated/*`). nestjs-i18n gộp tất cả loader thành **một** type `I18nTranslations`.
- Import `CoreI18nModule` vào `AppModule` (cùng nhóm core module).

### File generated

- `src/generated/i18n.generated.ts` được sinh ở dev (watch mode). Commit vào repo (như artifact generated được check-in) để `typecheck`/`build`/CI có sẵn type. Regenerate khi message thay đổi.

## 4. Bố cục file message (colocated)

```
src/common/i18n/vi.json
src/common/i18n/en.json                  # validation, lỗi HTTP chung, generic
src/modules/users/i18n/vi.json
src/modules/users/i18n/en.json
src/modules/auth/i18n/vi.json
src/modules/auth/i18n/en.json
src/modules/mail/i18n/vi.json
src/modules/mail/i18n/en.json
src/modules/notifications/i18n/vi.json
src/modules/notifications/i18n/en.json
```

- Mỗi loader trỏ vào folder `i18n/` của module; nestjs-i18n đọc `{lang}.json` trong đó.
- Namespace = tên folder cha của loader. Ví dụ message trong `modules/users/i18n/vi.json` truy cập qua key `users.NOT_FOUND`; trong `common/i18n/vi.json` qua `common.*`.
- Loader path dùng `path.join(__dirname, '../../modules/users/i18n')` (tương đối từ `dist/src/core/i18n` lúc runtime). Path chính xác xác minh khi implement.

### Ví dụ nội dung

`src/modules/users/i18n/vi.json`:
```json
{
  "NOT_FOUND": "Không tìm thấy người dùng",
  "EMAIL_TAKEN": "Email {email} đã được sử dụng"
}
```

`src/modules/users/i18n/en.json`:
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
import type { Path } from 'nestjs-i18n';
import type { I18nTranslations } from '@generated/i18n.generated';

export class AppException extends HttpException {
  constructor(
    readonly messageKey: Path<I18nTranslations>,   // typed — sai key là lỗi compile
    status: HttpStatus,
    readonly args?: Record<string, unknown>,        // nội suy {email}, {id}, ...
    readonly code?: string,                          // override code máy; mặc định suy từ status
  ) {
    super(messageKey, status);
  }
}
```

- Cách dùng trong service: `throw new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id })`.
- `messageKey` được type theo `I18nTranslations` → autocomplete và bắt sai key lúc compile.
- Kiểu chính xác của param key (`Path<I18nTranslations>` hay `keyof`) xác minh theo API thực tế của `nestjs-i18n` khi implement.

## 6. Luồng xử lý lỗi — sửa `HttpExceptionFilter`

File: `src/common/filters/http-exception.filter.ts`

- Inject thêm `I18nService<I18nTranslations>` (filter là `APP_FILTER` qua DI nên inject được).
- Khi `exception instanceof AppException`:
  - `lang = I18nContext.current()?.lang ?? <FALLBACK_LANGUAGE>` (nestjs-i18n đã resolve locale từ request qua resolver/middleware).
  - `message = i18n.translate(exception.messageKey, { lang, args: exception.args })`.
  - `code = exception.code ?? codeFromStatus(status)`.
  - `status = exception.getStatus()`.
- `ZodSerializationException`, `ZodValidationException`, và `HttpException` thường: **giữ nguyên** hành vi hiện tại.
- Shape `ErrorResponse` (`success`/`error.code`/`error.message`/`error.details`/`meta`) **không đổi**.

`AppException` phải được kiểm tra **trước** nhánh `HttpException` chung (vì nó kế thừa `HttpException`), tương tự cách `ZodValidationException` đang được kiểm tra trước.

## 7. Build — copy JSON sang dist

SWC builder không tự copy asset `.json`. Sửa `nest-cli.json`, thêm vào `compilerOptions`:

```json
"assets": [{ "include": "**/i18n/**/*.json", "watchAssets": true }],
"watchAssets": true
```

Một glob phủ toàn bộ folder `i18n/` của mọi module → copy sang `dist/` giữ nguyên cấu trúc thư mục. Đây là điểm cộng của bố cục colocated (không cần liệt kê từng module).

## 8. Env — `src/core/config/env.schema.ts`

Thêm:

```ts
DEFAULT_LANGUAGE: z.string().default('vi'),
FALLBACK_LANGUAGE: z.string().default('vi'),
```

- `DEFAULT_LANGUAGE`: locale dùng khi request không chỉ định (qua resolver mặc định nếu cần).
- `FALLBACK_LANGUAGE`: fallback của nestjs-i18n khi thiếu bản dịch.

## 9. Phạm vi áp dụng (migration)

- **Hạ tầng đầy đủ**: `CoreI18nModule`, `AppException`, sửa filter, sửa build, sửa env.
- **File message**: tạo cho `common`, `users`, `auth`, `mail`, `notifications` (cả vi + en).
- **Migrate sang `AppException`**: `users` và `auth` (có lỗi nghiệp vụ thật) — làm module tham chiếu, song song với pattern repository-port của dự án.
- `mail` / `notifications`: có file message sẵn, migrate sau khi phát sinh nhu cầu.

## 10. Kiểm thử

- `app.exception.spec.ts`: dựng đúng `status` / `messageKey` / `args` / `code`.
- `http-exception.filter.spec.ts`:
  - `AppException` → message được dịch đúng theo `lang` (vi và en).
  - Fallback về `FALLBACK_LANGUAGE` khi không có `I18nContext`.
  - `HttpException` thường và Zod exceptions: giữ nguyên hành vi.
  - Mock `I18nService.translate`.
- Cập nhật `users.service.spec.ts` / `auth.service.spec.ts` theo `AppException` đã thay cho `NotFoundException`/`ConflictException`...

## 11. Điểm cần verify khi implement

- Tương thích `nestjs-i18n` + Fastify adapter: resolver đọc header/query qua middleware của lib — kiểm tra chạy thật (request với `?lang=en`, header `Accept-Language: en`, header `x-lang: en`).
- Path tương đối của loader từ `dist/src/core/i18n` tới từng `dist/src/modules/<feature>/i18n` — xác nhận resolve đúng sau `pnpm build`.
- Kiểu param `messageKey` của `AppException` khớp API type-safety của `nestjs-i18n`.
- `I18nContext.current()` hoạt động trong filter (AsyncLocalStorage) dưới Fastify.

## 12. Danh sách file thay đổi (tóm tắt)

**Mới:**
- `src/core/i18n/i18n.module.ts`
- `src/common/exceptions/app.exception.ts`
- `src/common/i18n/{vi,en}.json`
- `src/modules/{users,auth,mail,notifications}/i18n/{vi,en}.json`
- `src/generated/i18n.generated.ts` (generated, committed)
- `src/common/exceptions/app.exception.spec.ts`

**Sửa:**
- `src/common/filters/http-exception.filter.ts` (+ spec)
- `src/app.module.ts` (import `CoreI18nModule`)
- `src/core/config/env.schema.ts`
- `nest-cli.json` (assets)
- `package.json` (dep `nestjs-i18n`)
- `src/modules/users/services/users.service.ts` (+ spec) — dùng `AppException`
- `src/modules/auth/services/auth.service.ts` (+ spec) — dùng `AppException`
