# GitHub Actions CI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo file `.github/workflows/ci.yml` — pipeline CI chạy tự động khi push vào nhánh `develop`, thực hiện tuần tự: generate code → lint → typecheck → unit test → build → migrate → e2e test với PostgreSQL/Redis/RabbitMQ.

**Architecture:** Single job trên `ubuntu-latest`, Node 24, pnpm. Services (Postgres 18, Redis 8, RabbitMQ 4) spin up cùng job và health-check trước khi chạy steps. Secrets nhạy cảm (JWT_SECRET) lấy từ GitHub Secrets; các biến còn lại hardcode trong workflow.

**Tech Stack:** GitHub Actions, Node 24, pnpm, NestJS 11, Prisma 7, Jest, Biome.

---

### Task 1: Tạo thư mục và file workflow CI

**Files:**
- Create: `.github/workflows/ci.yml`

- [x] **Step 1: Tạo thư mục**

```bash
mkdir -p .github/workflows
```

- [x] **Step 2: Tạo file `.github/workflows/ci.yml`**

> ⚠️ **Hai gotcha thực tế từ verify:**
> 1. `pnpm/action-setup@v4` cần `version: latest` — không có `packageManager` field trong `package.json` → action fail nếu thiếu.
> 2. `src/generated/` bị gitignore → phải chạy `prisma:generate` + `i18n:gen` trước lint/typecheck.

```yaml
name: CI

on:
  push:
    branches: [develop]

jobs:
  ci:
    name: Lint · Typecheck · Test · Build · E2E
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:18-alpine
        env:
          POSTGRES_USER: app
          POSTGRES_PASSWORD: app
          POSTGRES_DB: app
        ports:
          - 5432:5432
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      redis:
        image: redis:8-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

      rabbitmq:
        image: rabbitmq:4-management-alpine
        ports:
          - 5672:5672
        options: >-
          --health-cmd "rabbitmq-diagnostics -q ping"
          --health-interval 10s
          --health-timeout 10s
          --health-retries 5

    env:
      NODE_ENV: test
      PORT: 3000
      DATABASE_URL: postgresql://app:app@localhost:5432/app?schema=public
      REDIS_HOST: localhost
      REDIS_PORT: 6379
      RABBITMQ_URL: amqp://guest:guest@localhost:5672
      RABBITMQ_EXCHANGE: app
      RABBITMQ_PREFETCH: 10
      RABBITMQ_MAX_RETRIES: 3
      RABBITMQ_RETRY_DELAYS_MS: "5000,30000,300000"
      RABBITMQ_QUORUM_DELIVERY_LIMIT: 5
      RABBITMQ_IDEMPOTENCY_TTL: 86400
      RABBITMQ_OUTBOX_POLL_MS: 1000
      RABBITMQ_OUTBOX_BATCH: 50
      RABBITMQ_OUTBOX_MAX_ATTEMPTS: 10
      WORKER_PORT: 3001
      MAIL_WORKER_CONCURRENCY: 5
      BULLBOARD_USER: admin
      BULLBOARD_PASSWORD: admin
      LOG_FILE_ENABLED: "false"
      LOG_ERROR_FILE_ENABLED: "false"
      JWT_SECRET: ${{ secrets.JWT_SECRET }}

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: latest
          run_install: false

      - name: Setup Node.js 24
        uses: actions/setup-node@v4
        with:
          node-version: 24
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Generate Prisma client
        run: pnpm prisma:generate

      - name: Generate i18n types
        run: pnpm i18n:gen

      - name: Lint
        run: pnpm lint

      - name: Typecheck
        run: pnpm typecheck

      - name: Unit tests
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Migrate database
        run: pnpm prisma:deploy

      - name: E2E tests
        run: pnpm test:e2e
```

- [x] **Step 3: Kiểm tra syntax YAML hợp lệ (local)**

```bash
python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [x] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: thiết lập GitHub Actions CI — lint, typecheck, unit test, build, e2e"
```

---

### Task 2: Thêm GitHub Secret JWT_SECRET

**Files:** Không có file thay đổi — thao tác trên GitHub UI/CLI.

- [ ] **Step 1: Thêm secret qua GitHub CLI** (hoặc GitHub UI → Settings → Secrets → Actions)

```bash
gh secret set JWT_SECRET --body "your-secret-value-here"
```

Thay `your-secret-value-here` bằng giá trị JWT secret thực. Nếu dùng UI: repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.

- [ ] **Step 2: Xác nhận secret đã tồn tại**

```bash
gh secret list
```

Expected output chứa dòng:
```
JWT_SECRET    ...
```

---

### Task 3: Verify pipeline chạy đúng

- [x] **Step 1: Push lên nhánh develop**

```bash
git push origin feat/nestjs-fastify-boilerplate:develop
```

Hoặc nếu đã ở nhánh develop:

```bash
git push origin develop
```

- [x] **Step 2: Mở GitHub Actions và theo dõi run**

```bash
gh run list --branch develop --limit 5
```

Expected: Thấy run mới nhất với status `queued` hoặc `in_progress`.

- [x] **Step 3: Xem log real-time**

```bash
gh run watch
```

Chọn run mới nhất. Theo dõi từng step. Expected: tất cả steps pass với dấu ✓.

- [x] **Step 4: Nếu có step fail — xem log chi tiết**

```bash
gh run view --log-failed
```

Đọc error message, fix code, commit, push lại → CI tự trigger.
