# i18n Message Management System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hệ thống message text tập trung, đa ngôn ngữ (vi/en), type-safe; service ném exception mang message KEY, global filter dịch theo locale của request.

**Architecture:** `nestjs-i18n` với một `I18nJsonLoader` đọc `src/i18n/<lang>/<namespace>.json` (mỗi module một file namespace). `AppException extends HttpException` mang `messageKey` (typed `I18nPath`). `HttpExceptionFilter` inject `I18nService`, dịch `AppException.messageKey` khi bắt lỗi. Type được sinh bằng CLI `nestjs-i18n` (`pnpm i18n:gen`), không cần boot app.

**Tech Stack:** NestJS 11 + Fastify, nestjs-i18n@10.8.4, nestjs-zod, Temporal, SWC, Jest, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-05-i18n-message-system-design.md`

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/i18n/<lang>/<ns>.json` | Catalog message theo namespace (common/users/auth/mail/notifications) |
| `src/generated/i18n.generated.ts` | Type sinh tự động (gitignored), export `I18nTranslations` + `I18nPath` |
| `src/core/i18n/i18n.module.ts` | `CoreI18nModule` — cấu hình `I18nModule.forRootAsync` (loader, resolvers, fallback) |
| `src/common/exceptions/app.exception.ts` | `AppException` — HttpException mang `messageKey`/`args`/`code` |
| `src/common/filters/http-exception.filter.ts` | Thêm nhánh dịch `AppException` qua `I18nService` |

---

## Task 1: Cài dependency + scripts type-gen

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Cài nestjs-i18n + class-validator (peer)**

`class-validator` là peer dependency của nestjs-i18n (dù ta không dùng i18n validation pipe, một số module của lib require nó eager khi `import 'nestjs-i18n'`).

Run:
```bash
pnpm add nestjs-i18n class-validator
```
Expected: `nestjs-i18n` (≈10.8.4) và `class-validator` xuất hiện trong `dependencies`.

- [ ] **Step 2: Thêm scripts `i18n:gen` và sửa `verify`**

Sửa khối `"scripts"` trong `package.json`, thêm 2 dòng và sửa `verify`:

```json
"i18n:gen": "nestjs-i18n -p src/i18n -o src/generated/i18n.generated.ts --include-subfolders",
"i18n:gen:watch": "nestjs-i18n -p src/i18n -o src/generated/i18n.generated.ts --include-subfolders --watch",
"verify": "pnpm i18n:gen && pnpm check && pnpm typecheck && pnpm build",
```

(Giữ nguyên các script khác; chỉ thay nội dung `verify` cũ `"pnpm check && pnpm typecheck && pnpm build"`.)

- [ ] **Step 3: Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "build(i18n): add nestjs-i18n + class-validator, i18n:gen scripts"
```

---

## Task 2: Tạo file message + sinh type

**Files:**
- Create: `src/i18n/vi/common.json`, `src/i18n/en/common.json`
- Create: `src/i18n/vi/users.json`, `src/i18n/en/users.json`
- Create: `src/i18n/vi/auth.json`, `src/i18n/en/auth.json`
- Create: `src/i18n/vi/mail.json`, `src/i18n/en/mail.json`
- Create: `src/i18n/vi/notifications.json`, `src/i18n/en/notifications.json`
- Generated: `src/generated/i18n.generated.ts` (gitignored — KHÔNG commit)

- [ ] **Step 1: Tạo file `common` (vi + en)**

`src/i18n/vi/common.json`:
```json
{
  "INTERNAL_ERROR": "Lỗi máy chủ nội bộ",
  "VALIDATION_FAILED": "Dữ liệu không hợp lệ"
}
```

`src/i18n/en/common.json`:
```json
{
  "INTERNAL_ERROR": "Internal server error",
  "VALIDATION_FAILED": "Validation failed"
}
```

- [ ] **Step 2: Tạo file `users` (vi + en)**

`src/i18n/vi/users.json`:
```json
{
  "NOT_FOUND": "Không tìm thấy người dùng {id}",
  "EMAIL_TAKEN": "Email {email} đã được sử dụng"
}
```

`src/i18n/en/users.json`:
```json
{
  "NOT_FOUND": "User {id} not found",
  "EMAIL_TAKEN": "Email {email} is already in use"
}
```

- [ ] **Step 3: Tạo file `auth` (vi + en)**

`src/i18n/vi/auth.json`:
```json
{
  "EMAIL_TAKEN": "Email đã được đăng ký",
  "INVALID_CREDENTIALS": "Thông tin đăng nhập không hợp lệ"
}
```

`src/i18n/en/auth.json`:
```json
{
  "EMAIL_TAKEN": "Email already registered",
  "INVALID_CREDENTIALS": "Invalid credentials"
}
```

- [ ] **Step 4: Tạo file `mail` + `notifications` (catalog cho tương lai)**

`src/i18n/vi/mail.json`:
```json
{
  "SEND_FAILED": "Gửi email thất bại"
}
```

`src/i18n/en/mail.json`:
```json
{
  "SEND_FAILED": "Failed to send email"
}
```

`src/i18n/vi/notifications.json`:
```json
{
  "PUBLISH_FAILED": "Gửi thông báo thất bại"
}
```

`src/i18n/en/notifications.json`:
```json
{
  "PUBLISH_FAILED": "Failed to publish notification"
}
```

- [ ] **Step 5: Sinh type**

Run:
```bash
pnpm i18n:gen
```
Expected: `✅ Types generated in: src/generated/i18n.generated.ts`

- [ ] **Step 6: Verify type chứa đủ namespace**

Run:
```bash
grep -oE '"(common|users|auth|mail|notifications)"' src/generated/i18n.generated.ts | sort -u
```
Expected (5 dòng): `"auth"` `"common"` `"mail"` `"notifications"` `"users"`

Run thêm:
```bash
grep -E "I18nTranslations|I18nPath" src/generated/i18n.generated.ts
```
Expected: có `export type I18nTranslations = {` và `export type I18nPath = Path<I18nTranslations>;`

- [ ] **Step 7: Commit (chỉ file nguồn, KHÔNG file generated)**

`src/generated/` đã bị gitignore nên `git add src/i18n` sẽ không kéo theo file generated.

```bash
git add src/i18n
git status --short   # xác nhận KHÔNG có src/generated/i18n.generated.ts trong staged
git commit -m "feat(i18n): add message catalog files (vi/en) for all namespaces"
```

---

## Task 3: CoreI18nModule + wiring + build assets

**Files:**
- Create: `src/core/i18n/i18n.module.ts`
- Modify: `src/app.module.ts`
- Modify: `nest-cli.json`

- [ ] **Step 1: Tạo `CoreI18nModule`**

`src/core/i18n/i18n.module.ts`:
```ts
import { join } from 'node:path';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AcceptLanguageResolver,
  HeaderResolver,
  I18nJsonLoader,
  I18nModule,
  QueryResolver,
} from 'nestjs-i18n';
import type { Env } from '../config/env.schema';

// Bọc nestjs-i18n: một JSON loader đọc src/i18n/<lang>/<namespace>.json (sau build là
// dist/src/i18n). Locale resolve theo thứ tự: ?lang=/l → header x-lang → Accept-Language.
// fallbackLanguage lấy từ env. I18nModule tự đăng ký global nên I18nService dùng được toàn app.
@Global()
@Module({
  imports: [
    I18nModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        fallbackLanguage: config.get('FALLBACK_LANGUAGE', { infer: true }),
        loaders: [
          new I18nJsonLoader({
            path: join(__dirname, '..', '..', 'i18n'),
            watch: config.get('NODE_ENV', { infer: true }) !== 'production',
          }),
        ],
        resolvers: [
          new QueryResolver(['lang', 'l']),
          new HeaderResolver(['x-lang']),
          AcceptLanguageResolver,
        ],
      }),
    }),
  ],
})
export class CoreI18nModule {}
```

- [ ] **Step 2: Thêm `FALLBACK_LANGUAGE` vào env schema**

Mở `src/core/config/env.schema.ts`. Sau dòng `JWT_EXPIRES_IN: ...` (trước dấu `});` đóng `envSchema`), thêm:

```ts
  // Ngôn ngữ fallback của nestjs-i18n khi không resolve được locale hoặc thiếu bản dịch.
  FALLBACK_LANGUAGE: z.string().default('vi'),
```

- [ ] **Step 3: Import `CoreI18nModule` vào `AppModule`**

Trong `src/app.module.ts`, thêm import và đưa vào mảng `imports` (đặt cạnh các core module, vd sau `LoggerModule`):

```ts
import { CoreI18nModule } from './core/i18n/i18n.module';
```
```ts
    LoggerModule,
    CoreI18nModule,
    PrismaModule,
```

- [ ] **Step 4: Cấu hình copy asset JSON khi build**

Trong `nest-cli.json`, sửa `compilerOptions` để copy `src/i18n` sang `dist`:

```json
  "compilerOptions": {
    "deleteOutDir": true,
    "builder": "swc",
    "typeCheck": true,
    "assets": [{ "include": "i18n/**/*", "watchAssets": true }],
    "watchAssets": true
  }
```

- [ ] **Step 5: Typecheck**

Run:
```bash
pnpm typecheck
```
Expected: PASS (không lỗi). Nếu báo thiếu `@generated/i18n.generated`, chạy lại `pnpm i18n:gen` (Task 2).

- [ ] **Step 6: Build và kiểm tra asset được copy**

Run:
```bash
pnpm build && ls dist/src/i18n/vi dist/src/i18n/en
```
Expected: liệt kê đủ `common.json users.json auth.json mail.json notifications.json` ở cả `vi` và `en`.

- [ ] **Step 7: Commit**

```bash
git add src/core/i18n/i18n.module.ts src/core/config/env.schema.ts src/app.module.ts nest-cli.json
git commit -m "feat(i18n): wire CoreI18nModule, FALLBACK_LANGUAGE env, copy i18n assets"
```

---

## Task 4: AppException (TDD)

**Files:**
- Create: `src/common/exceptions/app.exception.ts`
- Test: `src/common/exceptions/app.exception.spec.ts`

- [ ] **Step 1: Viết test thất bại**

`src/common/exceptions/app.exception.spec.ts`:
```ts
import { HttpStatus } from '@nestjs/common';
import { AppException } from './app.exception';

describe('AppException', () => {
  it('carries messageKey as the HttpException message and the given status', () => {
    const ex = new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id: '1' });
    expect(ex.getStatus()).toBe(404);
    expect(ex.messageKey).toBe('users.NOT_FOUND');
    expect(ex.message).toBe('users.NOT_FOUND');
    expect(ex.args).toEqual({ id: '1' });
    expect(ex.code).toBeUndefined();
  });

  it('accepts an optional machine code override', () => {
    const ex = new AppException('auth.EMAIL_TAKEN', HttpStatus.CONFLICT, undefined, 'EMAIL_TAKEN');
    expect(ex.getStatus()).toBe(409);
    expect(ex.code).toBe('EMAIL_TAKEN');
  });
});
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run:
```bash
pnpm test -- app.exception.spec
```
Expected: FAIL — `Cannot find module './app.exception'`.

- [ ] **Step 3: Viết implementation tối thiểu**

`src/common/exceptions/app.exception.ts`:
```ts
import { HttpException, type HttpStatus } from '@nestjs/common';
import type { I18nPath } from '@generated/i18n.generated';

// Exception nghiệp vụ mang message KEY (không phải text). HttpExceptionFilter dịch key này
// sang locale của request qua I18nService. `args` để nội suy ({id}, {email}); `code` để override
// mã máy (mặc định filter suy từ HTTP status).
export class AppException extends HttpException {
  constructor(
    readonly messageKey: I18nPath,
    status: HttpStatus,
    readonly args?: Record<string, unknown>,
    readonly code?: string,
  ) {
    super(messageKey, status);
  }
}
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run:
```bash
pnpm test -- app.exception.spec
```
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/exceptions/app.exception.ts src/common/exceptions/app.exception.spec.ts
git commit -m "feat(i18n): add AppException carrying typed message key"
```

---

## Task 5: HttpExceptionFilter dịch AppException (TDD)

**Files:**
- Modify: `src/common/filters/http-exception.filter.ts`
- Test: `src/common/filters/http-exception.filter.spec.ts`

- [ ] **Step 1: Cập nhật spec — constructor mới + test AppException**

Trong `src/common/filters/http-exception.filter.spec.ts`:

(a) Thêm import ở đầu file:
```ts
import { HttpStatus } from '@nestjs/common';
import { AppException } from '../exceptions/app.exception';
```

(b) Thêm mock i18n và sửa khởi tạo filter. Thay block:
```ts
  const config = { get: jest.fn().mockReturnValue('test') } as never;
  let filter: HttpExceptionFilter;
```
thành:
```ts
  const config = { get: jest.fn().mockReturnValue('test') } as never;
  const i18n = { translate: jest.fn((key: string) => `translated:${key}`) };
  let filter: HttpExceptionFilter;
```
và thay `filter = new HttpExceptionFilter(config);` thành:
```ts
    filter = new HttpExceptionFilter(config, i18n as never);
```

(c) Thêm 2 test mới (trong `describe`):
```ts
  it('translates an AppException messageKey via I18nService and keeps status-derived code', () => {
    filter.catch(
      new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id: '1' }),
      host(req, res),
    );
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body().error.code).toBe('NOT_FOUND');
    expect(body().error.message).toBe('translated:users.NOT_FOUND');
    expect(i18n.translate).toHaveBeenCalledWith(
      'users.NOT_FOUND',
      expect.objectContaining({ args: { id: '1' } }),
    );
  });

  it('uses AppException.code override when provided', () => {
    filter.catch(
      new AppException('auth.EMAIL_TAKEN', HttpStatus.CONFLICT, undefined, 'EMAIL_TAKEN'),
      host(req, res),
    );
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body().error.code).toBe('EMAIL_TAKEN');
  });
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run:
```bash
pnpm test -- http-exception.filter.spec
```
Expected: FAIL — filter chưa biết `AppException` (message sẽ là `users.NOT_FOUND` thô, không phải `translated:...`), và constructor chưa nhận `i18n`.

- [ ] **Step 3: Sửa filter — inject I18nService, thêm nhánh AppException**

Trong `src/common/filters/http-exception.filter.ts`:

(a) Thêm imports (cạnh các import hiện có):
```ts
import { I18nContext, I18nService } from 'nestjs-i18n';
import type { I18nTranslations } from '@generated/i18n.generated';
import { AppException } from '../exceptions/app.exception';
```

(b) Sửa constructor:
```ts
  constructor(
    private readonly config: ConfigService,
    private readonly i18n: I18nService<I18nTranslations>,
  ) {}
```

(c) Trong `catch`, khai báo thêm biến code override cạnh `let message`/`let details`:
```ts
    let codeOverride: string | undefined;
```

(d) Thêm nhánh `AppException` **NGAY TRƯỚC** nhánh `else if (exception instanceof HttpException)` (vì AppException kế thừa HttpException — phải bắt trước):
```ts
    } else if (exception instanceof AppException) {
      status = exception.getStatus();
      message = this.i18n.translate(exception.messageKey, {
        lang: I18nContext.current()?.lang,
        args: exception.args,
      });
      codeOverride = exception.code;
```

(e) Sửa dòng dựng `code` trong `responseBody`:
```ts
        code: codeOverride ?? codeFromStatus(status),
```
(thay `code: codeFromStatus(status),`)

- [ ] **Step 4: Chạy test — xác nhận PASS toàn bộ filter spec**

Run:
```bash
pnpm test -- http-exception.filter.spec
```
Expected: PASS (các test cũ + 2 test mới). Nếu TS báo `translate` trả Promise, dừng và kiểm tra version nestjs-i18n (v10 `translate` đồng bộ trả `string`).

- [ ] **Step 5: Commit**

```bash
git add src/common/filters/http-exception.filter.ts src/common/filters/http-exception.filter.spec.ts
git commit -m "feat(i18n): translate AppException message keys in HttpExceptionFilter"
```

---

## Task 6: Migrate UsersService sang AppException (TDD)

**Files:**
- Modify: `src/modules/users/services/users.service.ts`
- Test: `src/modules/users/services/users.service.spec.ts`

- [ ] **Step 1: Cập nhật spec — kỳ vọng AppException**

Trong `src/modules/users/services/users.service.spec.ts`:

(a) Thay import dòng 1:
```ts
import { AppException } from '@common/exceptions/app.exception';
```
(bỏ `import { NotFoundException } from '@nestjs/common';`)

(b) Sửa 3 assertion lỗi:
- Test `findOne throws ...` — giữ assertion status, đổi tên + thêm instanceof:
```ts
  it('findOne throws AppException(404) when the user does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toBeInstanceOf(AppException);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });
```
- Test `update throws ...`: đổi `toBeInstanceOf(NotFoundException)` → `toBeInstanceOf(AppException)`.
- Test `remove throws ...`: đổi `toBeInstanceOf(NotFoundException)` → `toBeInstanceOf(AppException)`.

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run:
```bash
pnpm test -- users.service.spec
```
Expected: FAIL — service vẫn ném `NotFoundException`, không phải `AppException`.

- [ ] **Step 3: Sửa service**

Trong `src/modules/users/services/users.service.ts`:

(a) Thay import dòng 1:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '@common/exceptions/app.exception';
```

(b) Sửa `findOne`:
```ts
  async findOne(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id });
    }
    return user;
  }
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run:
```bash
pnpm test -- users.service.spec
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/users/services/users.service.ts src/modules/users/services/users.service.spec.ts
git commit -m "refactor(users): throw AppException(users.NOT_FOUND) for missing user"
```

---

## Task 7: Migrate AuthService sang AppException (TDD)

**Files:**
- Modify: `src/modules/auth/services/auth.service.ts`
- Test: `src/modules/auth/services/auth.service.spec.ts`

- [ ] **Step 1: Cập nhật spec — kỳ vọng AppException**

Trong `src/modules/auth/services/auth.service.spec.ts`:

(a) Thay import dòng 2:
```ts
import { AppException } from '@common/exceptions/app.exception';
```
(bỏ `import { ConflictException, UnauthorizedException } from '@nestjs/common';`)

(b) Sửa 2 assertion:
- Test `login throws Unauthorized ...`:
```ts
    await expect(service.login({ email: 'a@b.com', password: 'wrongpass' })).rejects.toBeInstanceOf(
      AppException,
    );
```
- Test `register throws Conflict ...`:
```ts
    await expect(
      service.register({ email: 'a@b.com', password: 'password123' }),
    ).rejects.toBeInstanceOf(AppException);
```

- [ ] **Step 2: Chạy test — xác nhận FAIL**

Run:
```bash
pnpm test -- auth.service.spec
```
Expected: FAIL — service vẫn ném `ConflictException`/`UnauthorizedException`.

- [ ] **Step 3: Sửa service**

Trong `src/modules/auth/services/auth.service.ts`:

(a) Thay import dòng 2:
```ts
import { HttpStatus, Injectable } from '@nestjs/common';
import { AppException } from '@common/exceptions/app.exception';
```
(bỏ `ConflictException`, `UnauthorizedException`)

(b) Sửa nhánh `register`:
```ts
    if (existing) {
      throw new AppException('auth.EMAIL_TAKEN', HttpStatus.CONFLICT);
    }
```

(c) Sửa nhánh `login`:
```ts
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new AppException('auth.INVALID_CREDENTIALS', HttpStatus.UNAUTHORIZED);
    }
```

- [ ] **Step 4: Chạy test — xác nhận PASS**

Run:
```bash
pnpm test -- auth.service.spec
```
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/auth/services/auth.service.ts src/modules/auth/services/auth.service.spec.ts
git commit -m "refactor(auth): throw AppException for email-taken and invalid-credentials"
```

---

## Task 8: Verify toàn bộ + smoke test resolver

**Files:** (không sửa — chỉ kiểm tra)

- [ ] **Step 1: Chạy full verify**

Run:
```bash
pnpm verify
```
Expected: `i18n:gen` OK → `check` OK → `typecheck` OK → `build` OK. Không lỗi.

- [ ] **Step 2: Chạy toàn bộ test**

Run:
```bash
pnpm test
```
Expected: tất cả suite PASS.

- [ ] **Step 3: Smoke test resolver (cần DB/Redis/RabbitMQ chạy)**

> Nếu chưa có hạ tầng, ghi lại là "pending manual verify" và xác nhận sau — phần dịch lõi đã được unit-test ở Task 5.

Khởi động app (`pnpm start:dev`), rồi với một user id không tồn tại, gọi endpoint `GET /users/<uuid-không-tồn-tại>` (route này yêu cầu JWT — đăng nhập lấy token trước, hoặc test một endpoint `@Public()` ném AppException nếu có). So sánh message theo locale:

```bash
# Mặc định (vi)
curl -s -H "Authorization: Bearer <token>" http://localhost:3000/users/00000000-0000-0000-0000-000000000000 | jq .error.message
# => "Không tìm thấy người dùng 00000000-..."

# Ép tiếng Anh qua query
curl -s -H "Authorization: Bearer <token>" "http://localhost:3000/users/00000000-0000-0000-0000-000000000000?lang=en" | jq .error.message
# => "User 00000000-... not found"

# Ép qua header x-lang
curl -s -H "Authorization: Bearer <token>" -H "x-lang: en" http://localhost:3000/users/00000000-0000-0000-0000-000000000000 | jq .error.message
# => bản tiếng Anh
```
Expected: message đổi theo locale; `error.code` vẫn `NOT_FOUND`; shape envelope không đổi.

- [ ] **Step 4 (tùy chọn): Cập nhật CLAUDE.md**

Thêm mục i18n ngắn vào `CLAUDE.md` (Stack + Convention): dùng `AppException('namespace.KEY', HttpStatus.X, args?)` để ném lỗi i18n; thêm message vào `src/i18n/<lang>/<namespace>.json`; chạy `pnpm i18n:gen` sau khi sửa message; thêm script `pnpm i18n:gen` vào bảng lệnh.

```bash
git add CLAUDE.md
git commit -m "docs(i18n): document AppException + i18n message workflow in CLAUDE.md"
```

---

## Self-review notes

- **Spec coverage:** §3 wiring → Task 3; §4 message files → Task 2; §5 AppException → Task 4; §6 filter → Task 5; §7 build assets → Task 3/Step 4; §8 env → Task 3/Step 2; §9 migration users/auth → Task 6/7; §3 type-gen scripts → Task 1; §10 tests → Task 4/5/6/7; §11 runtime verify → Task 8.
- **Type consistency:** `messageKey: I18nPath` (Task 4) khớp với key truyền vào `i18n.translate` (Task 5) và literal trong service (Task 6/7); constructor filter `(config, i18n)` khớp giữa filter (Task 5/Step 3) và spec (Task 5/Step 1).
- **Thứ tự bắt buộc:** Task 2 (sinh type) trước Task 4 (AppException import `I18nPath`). Task 4 trước Task 5/6/7 (đều dùng AppException).
