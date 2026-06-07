# GitHub Actions CI — Design Spec

**Date:** 2026-06-07  
**Status:** Approved

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
- **Package manager:** pnpm (cài qua `corepack enable`)
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
| 2 | Setup Node + pnpm cache | `actions/setup-node@v4` với `node-version: 24` + `cache: pnpm` |
| 3 | Install dependencies | `pnpm install --frozen-lockfile` |
| 4 | Lint | `pnpm lint` |
| 5 | Typecheck | `pnpm typecheck` |
| 6 | Unit tests | `pnpm test` |
| 7 | Build | `pnpm build` |
| 8 | Migrate DB | `pnpm prisma:deploy` |
| 9 | E2E tests | `pnpm test:e2e` |

Thứ tự có chủ ý: lint/typecheck/unit fail fast trước khi tốn thời gian build + e2e.

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
RABBITMQ_RETRY_DELAYS_MS=5000,30000,300000
RABBITMQ_QUORUM_DELIVERY_LIMIT=5
RABBITMQ_IDEMPOTENCY_TTL=86400
RABBITMQ_OUTBOX_POLL_MS=1000
RABBITMQ_OUTBOX_BATCH=50
RABBITMQ_OUTBOX_MAX_ATTEMPTS=10
WORKER_PORT=3001
MAIL_WORKER_CONCURRENCY=5
BULLBOARD_USER=admin
BULLBOARD_PASSWORD=admin
LOG_FILE_ENABLED=false
LOG_ERROR_FILE_ENABLED=false
```

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
