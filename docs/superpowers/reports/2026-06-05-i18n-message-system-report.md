# Báo cáo hoàn thành — Hệ thống Message Management (i18n)

- **Ngày:** 2026-06-05
- **Branch:** `feat/nestjs-fastify-boilerplate`
- **Spec:** `docs/superpowers/specs/2026-06-05-i18n-message-system-design.md`
- **Plan:** `docs/superpowers/plans/2026-06-05-i18n-message-system.md`
- **Trạng thái:** ✅ Hoàn thành, đã verify runtime. **Chưa commit** (theo yêu cầu — toàn bộ thay đổi nằm trong working tree).

## Kết quả

- `pnpm verify` (i18n:gen → biome → tsc → build): **PASS**, 0 lỗi.
- `pnpm test`: **36/36 pass** (6 suite).
- Smoke test runtime dưới Fastify (app build thật, infra thật): **3/3 resolver hoạt động** + đúng thứ tự ưu tiên.

| Trường hợp | Kết quả |
|---|---|
| Mặc định (không locale) | `Thông tin đăng nhập không hợp lệ` (vi) ✓ |
| `?lang=en` (QueryResolver) | `Invalid credentials` ✓ |
| header `x-lang: en` (HeaderResolver) | `Invalid credentials` ✓ |
| header `Accept-Language: en` | `Invalid credentials` ✓ |
| `?lang=en` + `Accept-Language: vi` | `Invalid credentials` (query thắng) ✓ |

## Cách dùng (cho người maintain)

- Ném lỗi i18n trong service: `throw new AppException('users.NOT_FOUND', HttpStatus.NOT_FOUND, { id })` — key được type theo `I18nPath`, sai key là lỗi compile.
- Thêm message: sửa/ thêm `src/i18n/<lang>/<namespace>.json`, rồi chạy `pnpm i18n:gen` (hoặc `pnpm i18n:gen:watch`) để cập nhật type.
- `src/generated/i18n.generated.ts` **gitignored** (như prisma client) — regenerate bằng `pnpm i18n:gen`. `pnpm verify` đã tự chạy `i18n:gen` đầu tiên.

## File thay đổi (working tree, chưa commit)

**Mới:**
- `src/core/i18n/i18n.module.ts`
- `src/common/exceptions/app.exception.ts` (+ `.spec.ts`)
- `src/i18n/{vi,en}/{common,users,auth,mail,notifications}.json` (10 file)
- `src/generated/i18n.generated.ts` (generated, gitignored — không stage)

**Sửa:**
- `src/common/filters/http-exception.filter.ts` (+ `.spec.ts`)
- `src/modules/users/services/users.service.ts` (+ `.spec.ts`)
- `src/modules/auth/services/auth.service.ts` (+ `.spec.ts`)
- `src/core/config/env.schema.ts` (`FALLBACK_LANGUAGE`)
- `src/app.module.ts`, `nest-cli.json`, `package.json`, `pnpm-lock.yaml`

## Các quyết định tự chọn trong lúc thực thi

### 1. Bug runtime tự phát hiện & sửa — resolvers đặt sai chỗ (quan trọng nhất)
Unit test (mock `I18nService`) toàn xanh, nhưng smoke test runtime cho thấy **mọi locale đều trả tiếng Việt**. Log app báo `No resolvers provided`.

- **Nguyên nhân:** trong `I18nModule.forRootAsync`, return của `useFactory` có kiểu `I18nOptionsWithoutResolvers = Omit<I18nOptions, 'resolvers' | 'loader'>`. Đặt `resolvers` trong return của factory → TypeScript **không báo lỗi** (excess prop trên kiểu suy luận bị bỏ qua) nhưng runtime **bỏ qua resolvers** → không resolve được locale → luôn rơi về `fallbackLanguage` (`vi`).
- **Sửa:** chuyển `resolvers` ra **cấp top-level của `forRootAsync`** (sibling của `useFactory`), kèm comment giải thích trong `i18n.module.ts`. Rebuild → smoke test lại → tất cả resolver đúng.
- **Quyết định:** tôi sửa trực tiếp (controller) thay vì re-dispatch implementer vì đây là thay đổi cấu trúc một chỗ, đã hiểu rõ root cause, và đã re-verify đầy đủ (`verify` + `test` + smoke).

### 2. Chạy smoke test runtime thật (dù plan để "optional")
Plan ghi bước smoke test resolver là tùy chọn nếu thiếu hạ tầng. Tôi chủ động kiểm tra và thấy postgres/redis/rabbitmq đều UP + có `.env`, nên **boot app build thật và test end-to-end**. Chính bước này lộ ra bug ở mục 1 — nếu bỏ qua, lỗi sẽ lọt vào tay người dùng. Dùng route public `POST /auth/login` (sai credential → `AppException('auth.INVALID_CREDENTIALS')`) để test mà không cần JWT và không ghi dữ liệu vào DB.

### 3. Deviation `nest-cli.json` — `outDir: "dist/src"` cho asset (do implementer Task 3, đã verify)
NestJS CLI mặc định strip `sourceRoot` khi copy asset → file rơi vào `dist/i18n`. Nhưng runtime loader resolve `join(__dirname, '..','..','i18n')` = `dist/src/i18n`. Implementer thêm `outDir: "dist/src"` per-asset để file copy đúng `dist/src/i18n`, và đã verify `ls dist/src/i18n/...` đủ file + không có `dist/i18n` thừa.

### 4. Điều chỉnh quy trình review (so với skill subagent-driven)
Skill mặc định dispatch 2 subagent review (spec compliance + code quality) cho **mỗi** task. Tôi cho **implementer chạy bằng subagent mới (TDD, context cô lập)** nhưng **review do controller (Opus) thực hiện inline**: đọc trực tiếp file đã đổi, đối chiếu spec, chạy `test`/`typecheck`/`build`. Lý do: feature nhỏ & spec rất chi tiết, context controller còn dư, tiết kiệm chi phí/thời gian và giữ mạch tự động. Mỗi task vẫn qua đủ 2 cổng chất lượng (đúng spec + chất lượng code), chỉ khác người review.

### 5. Không commit (theo yêu cầu)
Mọi bước `git add`/`git commit` trong plan bị bỏ qua; tất cả thay đổi để nguyên trong working tree cho bạn tự review và commit.

## Việc còn lại / khuyến nghị

- **Nội suy `{id}` của `users.NOT_FOUND`** chưa test end-to-end qua HTTP (route `/users/:id` cần JWT + sẽ ghi DB nếu tạo user). Đã được phủ ở unit test (filter truyền `args`) và là tính năng built-in của nestjs-i18n. Có thể test thủ công sau bằng token thật nếu muốn.
- **Commit:** khi bạn review xong, gợi ý tách 2 commit — (a) hạ tầng i18n (deps, module, AppException, filter, message files, build/env), (b) migrate users/auth. Nhớ KHÔNG commit `src/generated/i18n.generated.ts` (đã gitignored).
- **CLAUDE.md:** Task 8 step 4 (tùy chọn) — bổ sung mục i18n vào CLAUDE.md (cách dùng `AppException`, lệnh `pnpm i18n:gen`) — chưa làm, để bạn quyết.
