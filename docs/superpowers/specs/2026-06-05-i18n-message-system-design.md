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
  - **loaders**: một `I18nJsonLoader` cho mỗi nguồn message — `common` + mỗi feature module (`users`, `auth`, `mail`, `notifications`). Mỗi loader có `path` trỏ vào folder `i18n/` của nguồn đó (folder chứa các thư mục ngôn ngữ `vi/`, `en/`); nestjs-i18n deep-merge translation của tất cả loader. Thêm module/package mới = thêm một entry loader. **Đây là cơ chế "extend"**.
  - **resolvers** (thứ tự ưu tiên): `QueryResolver(['lang', 'l'])`, `HeaderResolver(['x-lang'])`, `AcceptLanguageResolver`.
  - **fallbackLanguage**: lấy từ env (`FALLBACK_LANGUAGE`).
  - **typesOutputPath**: `src/generated/i18n.generated.ts` (hợp path alias `@generated/*`). nestjs-i18n gộp tất cả loader thành **một** type `I18nTranslations`.
- Import `CoreI18nModule` vào `AppModule` (cùng nhóm core module).

### File generated

- `src/generated/i18n.generated.ts` được nestjs-i18n sinh lúc app boot khi set `typesOutputPath` (ở dev watch mode tự cập nhật khi message đổi).
- **Lưu ý gitignore:** `.gitignore` hiện ignore toàn bộ `/src/generated` (prisma client cũng nằm đây). Vì nestjs-i18n **không** có CLI generate standalone gọn như `prisma generate`, ta **commit** file type này và thêm exception un-ignore vào `.gitignore`:
  ```gitignore
  /src/generated
  !/src/generated/i18n.generated.ts
  ```
  → `typecheck` / `build` / CI trên fresh clone có sẵn type mà không cần boot app. Khi message đổi, dev watch cập nhật file → commit diff.

## 4. Bố cục file message (colocated)

Stock `I18nJsonLoader` yêu cầu cấu trúc `<loaderPath>/<lang>/<namespace>.json`: **ngôn ngữ là thư mục con**, **namespace là tên file**. Vì vậy mỗi nguồn có folder `i18n/` chứa các thư mục `vi/`, `en/`, và trong đó là file `<namespace>.json`:

```
src/common/i18n/vi/common.json
src/common/i18n/en/common.json                  # validation, lỗi HTTP chung, generic → key common.*
src/modules/users/i18n/vi/users.json
src/modules/users/i18n/en/users.json            # → key users.*
src/modules/auth/i18n/vi/auth.json
src/modules/auth/i18n/en/auth.json              # → key auth.*
src/modules/mail/i18n/vi/mail.json
src/modules/mail/i18n/en/mail.json              # → key mail.*
src/modules/notifications/i18n/vi/notifications.json
src/modules/notifications/i18n/en/notifications.json  # → key notifications.*
```

- Mỗi loader `path` trỏ vào folder `i18n/` (vd `src/modules/users/i18n`); nestjs-i18n phát hiện ngôn ngữ từ thư mục con (`vi`, `en`) và namespace từ tên file (`users.json` → namespace `users`).
- Ví dụ key: message trong `modules/users/i18n/vi/users.json` truy cập qua `users.NOT_FOUND`; trong `common/i18n/vi/common.json` qua `common.*`.
- Loader path dùng `path.join(__dirname, '../../modules/users/i18n')` (tương đối từ `dist/src/core/i18n` lúc runtime). Path chính xác xác minh khi implement.

### Ví dụ nội dung

`src/modules/users/i18n/vi/users.json`:
```json
{
  "NOT_FOUND": "Không tìm thấy người dùng",
  "EMAIL_TAKEN": "Email {email} đã được sử dụng"
}
```

`src/modules/users/i18n/en/users.json`:
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
FALLBACK_LANGUAGE: z.string().default('vi'),
```

- `FALLBACK_LANGUAGE`: set vào `fallbackLanguage` của nestjs-i18n — dùng khi không resolver nào trả về ngôn ngữ, hoặc thiếu bản dịch cho locale yêu cầu.
- **Không** thêm `DEFAULT_LANGUAGE` riêng: `fallbackLanguage` đã phủ trường hợp "không xác định được locale", nên một biến default thứ hai chỉ gây nhập nhằng (YAGNI).

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
- `src/common/i18n/{vi,en}/common.json`
- `src/modules/users/i18n/{vi,en}/users.json`
- `src/modules/auth/i18n/{vi,en}/auth.json`
- `src/modules/mail/i18n/{vi,en}/mail.json`
- `src/modules/notifications/i18n/{vi,en}/notifications.json`
- `src/generated/i18n.generated.ts` (generated, committed qua exception gitignore)
- `src/common/exceptions/app.exception.spec.ts`

**Sửa:**
- `src/common/filters/http-exception.filter.ts` (+ spec)
- `src/app.module.ts` (import `CoreI18nModule`)
- `src/core/config/env.schema.ts` (`FALLBACK_LANGUAGE`)
- `nest-cli.json` (assets)
- `.gitignore` (un-ignore `i18n.generated.ts`)
- `package.json` (dep `nestjs-i18n`)
- `src/modules/users/services/users.service.ts` (+ spec) — dùng `AppException`
- `src/modules/auth/services/auth.service.ts` (+ spec) — dùng `AppException`
