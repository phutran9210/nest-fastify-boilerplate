# GitHub Actions CI — Design Spec

**Date:** 2026-06-07  
**Status:** Implemented ✅ (verified 2026-06-07, run #27089542003)

---

## Mục tiêu

Thiết lập CI pipeline tự động chạy khi có push vào nhánh `develop`, đảm bảo code chất lượng trước khi merge lên `main`.

---

## Trigger

```yaml
on:
  push:
    branches: [develop]
```

Chỉ trigger khi merge/push vào `develop`. Không chạy trên PR hay nhánh feature.

---

## Runtime

- **Node.js:** 24
- **Package manager:** pnpm — cài qua `pnpm/action-setup@v4` với `version: latest` (bắt buộc vì `package.json` không có `packageManager` field; thiếu field này action sẽ fail)
- **OS:** `ubuntu-latest`

---

## Services

Spin up cùng job (GitHub Actions `services:`), health-check trước khi chạy steps. Dùng image giống `docker-compose.yml` để tránh drift.

| Service    | Image                             | Container port | Exposed port |
|------------|-----------------------------------|----------------|--------------|
| PostgreSQL | `postgres:18-alpine`              | 5432           | 5432         |
| Redis      | `redis:8-alpine`                  | 6379           | 6379         |
| RabbitMQ   | `rabbitmq:4-management-alpine`    | 5672           | 5672         |

---

## Steps (tuần tự, fail-fast)

| # | Step | Lệnh |
|---|------|------|
| 1 | Checkout | `actions/checkout@v4` |
| 2 | Setup pnpm | `pnpm/action-setup@v4` với `version: latest` |
| 3 | Setup Node + pnpm cache | `actions/setup-node@v4` với `node-version: 24` + `cache: pnpm` |
| 4 | Install dependencies | `pnpm install --frozen-lockfile` |
| 5 | Generate Prisma client | `pnpm prisma:generate` |
| 6 | Generate i18n types | `pnpm i18n:gen` |
| 7 | Lint | `pnpm lint` |
| 8 | Typecheck | `pnpm typecheck` |
| 9 | Unit tests | `pnpm test` |
| 10 | Build | `pnpm build` |
| 11 | Migrate DB | `pnpm prisma:deploy` |
| 12 | E2E tests | `pnpm test:e2e` |

Thứ tự có chủ ý: generate code trước (Prisma client + i18n types nằm trong `src/generated/` bị gitignore, CI cần tạo lại) → lint/typecheck fail fast → unit test → build → e2e.

---

## Environment Variables

Biến CI trỏ vào services của job (port tiêu chuẩn, không phải host port lệch như local dev):

```
NODE_ENV=test
PORT=3000
DATABASE_URL=postgresql://app:app@localhost:5432/app?schema=public
REDIS_HOST=localhost
REDIS_PORT=6379
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_EXCHANGE=app
RABBITMQ_PREFETCH=10
RABBITMQ_MAX_RETRIES=3
RABBITMQ_RETRY_DELAYS_MS="5000,30000,300000"
RABBITMQ_QUORUM_DELIVERY_LIMIT=5
RABBITMQ_IDEMPOTENCY_TTL=86400
RABBITMQ_OUTBOX_POLL_MS=1000
RABBITMQ_OUTBOX_BATCH=50
RABBITMQ_OUTBOX_MAX_ATTEMPTS=10
WORKER_PORT=3001
MAIL_WORKER_CONCURRENCY=5
BULLBOARD_USER=admin
BULLBOARD_PASSWORD=admin
LOG_FILE_ENABLED="false"
LOG_ERROR_FILE_ENABLED="false"
```

> **YAML quoting:** `LOG_FILE_ENABLED` và `LOG_ERROR_FILE_ENABLED` phải đặt trong quotes (`"false"`) — YAML parse unquoted `false` thành boolean, không phải string.

Secrets nhạy cảm lấy từ **GitHub Secrets**:

| Secret name | Mô tả |
|---|---|
| `JWT_SECRET` | JWT signing key cho e2e auth |

---

## File output

```
.github/
└── workflows/
    └── ci.yml
```

---

## Quyết định thiết kế

- **Single job** — fail-fast rõ ràng, log liền mạch, dễ debug hơn multi-job.
- **`pnpm prisma:deploy`** thay vì `prisma:migrate` — dùng `migrate deploy` (production-safe, không prompt) thay vì `migrate dev`.
- **Port tiêu chuẩn trong CI** — services dùng port gốc (5432, 6379, 5672); local dev dùng port lệch (5433, 6380, 5673) để tránh conflict với service đang chạy trên máy.
- **`--frozen-lockfile`** — đảm bảo CI không tự cập nhật `pnpm-lock.yaml`.
- **`pnpm/action-setup@v4` cần `version: latest`** — action yêu cầu version rõ ràng khi `package.json` không có `packageManager` field; thiếu sẽ fail ngay bước setup.
- **Generate trước lint/typecheck** — `src/generated/` (Prisma client + i18n types) bị gitignore; CI phải chạy `prisma:generate` + `i18n:gen` trước khi typecheck, nếu không tsc không tìm thấy types và fail.
