# Dockerfile — Design Spec

**Date:** 2026-06-07  
**Status:** Approved

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
- `COPY package.json pnpm-lock.yaml ./`
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
- Copy từ source: `prisma/` (schema cần cho `prisma migrate deploy` lúc runtime nếu cần)
- `EXPOSE 3000`
- `CMD ["node", "dist/src/main.js"]`

### Stage 4: `worker`

```
FROM node:24-alpine AS worker
```

- Giống `api`, chỉ khác CMD
- `EXPOSE 3001`
- `CMD ["node", "dist/src/main.worker.js"]`

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
  restart: unless-stopped
  depends_on:
    postgres:
      condition: service_healthy
    redis:
      condition: service_healthy
    rabbitmq:
      condition: service_healthy
    api:
      condition: service_started
```

---

## Env trong Docker context

Khi chạy trong Docker, các service infra ở cùng Docker network — host không phải `localhost` mà là tên service. File `.env` dùng cho local dev (port lệch, host localhost). Khi `docker compose up`, cần override:

| Biến | Local dev | Docker compose |
|---|---|---|
| `DATABASE_URL` | `postgresql://app:app@localhost:5433/app` | `postgresql://app:app@postgres:5432/app` |
| `REDIS_HOST` | `localhost` | `redis` |
| `REDIS_PORT` | `6380` | `6379` |
| `RABBITMQ_URL` | `amqp://guest:guest@localhost:5673` | `amqp://guest:guest@rabbitmq:5672` |

Giải pháp: dùng `environment:` block trong `docker-compose.yml` để override các biến này (thay vì sửa `.env`).

---

## File output

```
Dockerfile
.dockerignore
docker-compose.yml  (modified)
```

---

## Quyết định thiết kế

- **`pnpm prune --prod` trong build stage** — giữ image runtime nhỏ; chỉ prod deps được copy sang `api`/`worker`.
- **`prisma/` schema copy vào runtime** — cần thiết nếu app chạy `prisma migrate deploy` lúc startup; nếu không cần có thể bỏ.
- **`env_file: .env` + `environment:` override** — không tạo file `.env.docker` riêng, tránh duplicate; chỉ override đúng các biến khác nhau giữa local và Docker context.
- **`api: condition: service_started`** trên worker — worker phụ thuộc API về mặt logic (outbox relay publish qua cùng RMQ topology), nhưng không cần API healthy mới start được.
