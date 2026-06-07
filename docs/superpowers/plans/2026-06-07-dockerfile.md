# Dockerfile Multi-stage Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo `Dockerfile` multi-stage 4 targets (`deps → build → api → worker`), `.dockerignore`, và cập nhật `docker-compose.yml` để thêm `api` + `worker` service với healthcheck + env override đúng cho Docker network.

**Architecture:** Một `Dockerfile` duy nhất, base `node:24-alpine`. Stage `deps` cài toàn bộ deps; `build` generate code + compile; `api`/`worker` là runtime image gọn chỉ chứa `dist/` + prod deps. `docker-compose.yml` thêm healthcheck cho infra services và 2 app services với `environment:` override host/port cho Docker network.

**Tech Stack:** Docker multi-stage, node:24-alpine, pnpm, NestJS 11, Prisma 7.

---

## File Structure

| File | Action |
|------|--------|
| `Dockerfile` | Create — 4-stage build |
| `.dockerignore` | Create — loại trừ node_modules, dist, .env, test, logs |
| `docker-compose.yml` | Modify — thêm healthcheck cho postgres/redis/rabbitmq + service api + worker |

---

### Task 1: Tạo `.dockerignore`

**Files:**
- Create: `.dockerignore`

- [ ] **Step 1: Tạo file `.dockerignore`**

```
node_modules
dist
.env
.env.*
!.env.example
test
coverage
logs
docs
*.spec.ts
*.e2e-spec.ts
.git
.github
```

- [ ] **Step 2: Verify — đảm bảo các file quan trọng KHÔNG bị ignore**

```bash
echo "package.json" | docker buildx build --file /dev/stdin . 2>/dev/null || true
# Nếu không có docker, dùng cách thủ công:
cat .dockerignore
# Kiểm tra: pnpm-workspace.yaml, .npmrc, prisma/, src/ KHÔNG có trong list
```

- [ ] **Step 3: Commit**

```bash
git add .dockerignore
git commit -m "build: thêm .dockerignore"
```

---

### Task 2: Tạo `Dockerfile` multi-stage

**Files:**
- Create: `Dockerfile`

- [ ] **Step 1: Tạo `Dockerfile` với nội dung sau**

```dockerfile
# ─── Stage 1: deps ──────────────────────────────────────────────────────────
FROM node:24-alpine AS deps

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy các file pnpm cần trước khi install
# pnpm-workspace.yaml: chứa allowBuilds policy — thiếu → ERR_PNPM_IGNORED_BUILDS
# .npmrc: chứa approve-builds=true
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./

RUN pnpm install --frozen-lockfile

# ─── Stage 2: build ─────────────────────────────────────────────────────────
FROM node:24-alpine AS build

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN pnpm prisma:generate
RUN pnpm i18n:gen
RUN pnpm build
RUN pnpm prune --prod

# ─── Stage 3: api ───────────────────────────────────────────────────────────
FROM node:24-alpine AS api

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3000

CMD ["node", "dist/src/main.js"]

# ─── Stage 4: worker ────────────────────────────────────────────────────────
FROM node:24-alpine AS worker

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3001

CMD ["node", "dist/src/main.worker.js"]
```

- [ ] **Step 2: Build image `api` để kiểm tra**

```bash
docker build --target api -t nest-app-api:test .
```

Expected: build thành công, không có lỗi. Nếu fail ở `pnpm install` với `ERR_PNPM_IGNORED_BUILDS` → kiểm tra `pnpm-workspace.yaml` đã được COPY chưa.

- [ ] **Step 3: Build image `worker` để kiểm tra**

```bash
docker build --target worker -t nest-app-worker:test .
```

Expected: build thành công (dùng lại cache từ bước trên, nhanh hơn).

- [ ] **Step 4: Verify image size**

```bash
docker images | grep nest-app
```

Expected: mỗi image ~300-500MB (node:24-alpine + prod deps + dist, không có devDeps).

- [ ] **Step 5: Commit**

```bash
git add Dockerfile
git commit -m "build: Dockerfile multi-stage — deps/build/api/worker (node:24-alpine)"
```

---

### Task 3: Cập nhật `docker-compose.yml` — healthcheck + app services

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Thay thế toàn bộ `docker-compose.yml` bằng nội dung sau**

```yaml
services:
  postgres:
    image: postgres:18-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - '5433:5432'
    volumes:
      - pgdata:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U app -d app"]
      interval: 10s
      timeout: 5s
      retries: 5

  redis:
    image: redis:8-alpine
    restart: unless-stopped
    ports:
      - '6380:6379'
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5

  rabbitmq:
    image: rabbitmq:4-management-alpine
    restart: unless-stopped
    ports:
      - '5673:5672'
      - '15673:15672'
    healthcheck:
      test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
      interval: 10s
      timeout: 10s
      retries: 5

  api:
    build:
      context: .
      target: api
    ports:
      - '3000:3000'
    env_file: .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://app:app@postgres:5432/app?schema=public
      REDIS_HOST: redis
      REDIS_PORT: 6379
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      BULLBOARD_PASSWORD: change-me
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

  worker:
    build:
      context: .
      target: worker
    ports:
      - '3001:3001'
    env_file: .env
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://app:app@postgres:5432/app?schema=public
      REDIS_HOST: redis
      REDIS_PORT: 6379
      RABBITMQ_URL: amqp://guest:guest@rabbitmq:5672
      BULLBOARD_PASSWORD: change-me
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
      rabbitmq:
        condition: service_healthy

volumes:
  pgdata:
```

- [ ] **Step 2: Validate YAML syntax**

```bash
python3 -c "import yaml; yaml.safe_load(open('docker-compose.yml'))" && echo "YAML OK"
```

Expected: `YAML OK`

- [ ] **Step 3: Commit**

```bash
git add docker-compose.yml
git commit -m "build: cập nhật docker-compose — healthcheck infra + service api + worker"
```

---

### Task 4: Smoke test `docker compose up`

- [ ] **Step 1: Đảm bảo infra đang down (tránh port conflict)**

```bash
docker compose down
```

- [ ] **Step 2: Start toàn bộ stack**

```bash
docker compose up --build -d
```

Expected: tất cả services start, không có container ở trạng thái `Exit`.

- [ ] **Step 3: Kiểm tra trạng thái containers**

```bash
docker compose ps
```

Expected output (tất cả `running` hoặc `healthy`):
```
NAME                STATUS
...-postgres-1      running (healthy)
...-redis-1         running (healthy)
...-rabbitmq-1      running (healthy)
...-api-1           running
...-worker-1        running
```

- [ ] **Step 4: Kiểm tra API health endpoint**

```bash
curl -s http://localhost:3000/health | python3 -m json.tool
```

Expected: JSON response với `status: "ok"` (hoặc tương đương từ `HealthController`).

- [ ] **Step 5: Kiểm tra Worker health endpoint**

```bash
curl -s http://localhost:3001/health | python3 -m json.tool
```

Expected: JSON response với `status: "ok"`.

- [ ] **Step 6: Kiểm tra logs nếu có container fail**

```bash
docker compose logs api --tail=50
docker compose logs worker --tail=50
```

Tìm lỗi config (missing env, connection refused, v.v.) và fix.

- [ ] **Step 7: Teardown sau khi test xong**

```bash
docker compose down
```

- [ ] **Step 8: Commit final nếu có fix**

```bash
git add -A
git commit -m "build: fix docker compose smoke test issues"
```
