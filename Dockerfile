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

RUN DATABASE_URL="postgresql://x:x@localhost:5432/x" pnpm prisma:generate
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

USER node

CMD ["node", "dist/src/main.js"]

# ─── Stage 4: worker ────────────────────────────────────────────────────────
FROM node:24-alpine AS worker

WORKDIR /app

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 3001

USER node

CMD ["node", "dist/src/main.worker.js"]
