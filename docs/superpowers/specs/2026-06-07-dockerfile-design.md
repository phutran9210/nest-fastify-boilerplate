# Dockerfile — Design Spec

**Date:** 2026-06-07  
**Status:** Approved (revised sau review)

---

## Mục tiêu

Đóng gói NestJS API và Worker thành Docker image production-ready. Một `Dockerfile` duy nhất với multi-stage build, hai `--target` (`api`, `worker`). Cập nhật `docker-compose.yml` để thêm `api` + `worker` service.

---

## Dockerfile — 4 stages

Base image: `node:24-alpine` xuyên suốt.

### Stage 1: `deps`

```
FROM node:24-alpine AS deps
```

- Cài pnpm qua `corepack enable && corepack prepare pnpm@latest --activate`
- Copy các file cần thiết cho pnpm install trước khi copy toàn bộ source:
  ```
  COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
  ```
  > **Lý do:** `pnpm-workspace.yaml` chứa `allowBuilds` policy — thiếu file này, `pnpm install` fail với `ERR_PNPM_IGNORED_BUILDS`. `.npmrc` có `approve-builds=true` cũng cần có mặt.
- `pnpm install --frozen-lockfile` — cài **toàn bộ** deps (bao gồm devDeps cho build)

### Stage 2: `build`

```
FROM node:24-alpine AS build
```

- Copy từ `deps`: `node_modules`
- Copy source: toàn bộ project (trừ những gì trong `.dockerignore`)
- `pnpm prisma:generate` — sinh Prisma client vào `src/generated/prisma`
- `pnpm i18n:gen` — sinh i18n types vào `src/generated/i18n.generated.ts`
- `pnpm build` — `nest build` → output ra `dist/`
- `pnpm prune --prod` — xóa devDeps, giữ lại prod deps cho copy sang runtime stage

### Stage 3: `api`

```
FROM node:24-alpine AS api
```

- Copy từ `build`: `dist/`, `node_modules/`, `package.json`
- `EXPOSE 3000`
- `CMD ["node", "dist/src/main.js"]`

> **Không copy `prisma/`:** `prisma` CLI là devDep — bị xóa sau `pnpm prune --prod`. Migration **không chạy trong container app**; chạy riêng trước khi deploy (xem mục Migration bên dưới).

### Stage 4: `worker`

```
FROM node:24-alpine AS worker
```

- Giống `api`, chỉ khác CMD
- `EXPOSE 3001`
- `CMD ["node", "dist/src/main.worker.js"]`

---

## Migration strategy

Migration **không chạy trong container `api` hay `worker`** vì `prisma` CLI (devDep) và `prisma.config.ts` không có trong runtime image sau `pnpm prune --prod`.

Cách chạy migration trước khi deploy:
```bash
# Chạy một lần trước khi start containers
docker run --rm \
  -e DATABASE_URL=... \
  --network <compose_network> \
  <api-image> \
  sh -c "npx prisma migrate deploy"
```

Hoặc dùng `docker compose run --rm api npx prisma migrate deploy` nếu `prisma` CLI có trong prod deps. Trong scope hiện tại: **migration chạy thủ công ngoài Docker**, không tích hợp vào image.

---

## .dockerignore

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

---

## docker-compose.yml — thay đổi

### Thêm healthcheck vào infra services hiện tại

`depends_on: condition: service_healthy` yêu cầu các service infra có `healthcheck`.

**postgres:**
```yaml
healthcheck:
  test: ["CMD-SHELL", "pg_isready -U app -d app"]
  interval: 10s
  timeout: 5s
  retries: 5
```

**redis:**
```yaml
healthcheck:
  test: ["CMD", "redis-cli", "ping"]
  interval: 10s
  timeout: 5s
  retries: 5
```

**rabbitmq:**
```yaml
healthcheck:
  test: ["CMD", "rabbitmq-diagnostics", "-q", "ping"]
  interval: 10s
  timeout: 10s
  retries: 5
```

### Thêm service `api`

```yaml
api:
  build:
    context: .
    target: api
  ports:
    - "3000:3000"
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
```

### Thêm service `worker`

```yaml
worker:
  build:
    context: .
    target: worker
  ports:
    - "3001:3001"
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
```

> **`NODE_ENV: production`** bắt buộc — `env.schema.ts` enforce `BULLBOARD_PASSWORD` required ở production; thiếu thì worker không boot.
> **`BULLBOARD_PASSWORD: change-me`** — placeholder, thay bằng giá trị thực trước khi deploy. `worker` không depends_on `api` vì không có runtime dependency thực sự.

---

## Env trong Docker context

`environment:` block override `.env` file — các biến thay đổi giữa local dev và Docker:

| Biến | Local dev | Docker compose |
|---|---|---|
| `NODE_ENV` | `development` | `production` |
| `DATABASE_URL` | `postgresql://app:app@localhost:5433/app` | `postgresql://app:app@postgres:5432/app` |
| `REDIS_HOST` | `localhost` | `redis` |
| `REDIS_PORT` | `6380` | `6379` |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5673` | `amqp://guest:guest@rabbitmq:5672` |
| `BULLBOARD_PASSWORD` | *(dev fallback `admin`)* | bắt buộc set |

---

## File output

```
Dockerfile
.dockerignore
docker-compose.yml  (modified)
```

---

## Quyết định thiết kế

- **`pnpm-workspace.yaml` + `.npmrc` copy trước install** — `pnpm-workspace.yaml` chứa `allowBuilds` policy; thiếu → `ERR_PNPM_IGNORED_BUILDS`. `.npmrc` có `approve-builds=true`.
- **`pnpm prune --prod` trong build stage** — giữ image runtime nhỏ; chỉ prod deps được copy sang `api`/`worker`.
- **Không copy `prisma/` vào runtime** — `prisma` CLI là devDep, bị xóa sau prune; migration chạy ngoài Docker.
- **`env_file: .env` + `environment:` override** — không tạo file `.env.docker` riêng; chỉ override đúng các biến khác nhau.
- **`NODE_ENV: production` explicit** — bắt buộc để trigger production validation (BULLBOARD_PASSWORD required).
- **Worker không depends_on api** — không có runtime dependency thực sự; worker tự assert RMQ topology độc lập.
