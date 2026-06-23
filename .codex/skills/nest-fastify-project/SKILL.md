---
name: nest-fastify-project
description: Project-specific workflows and conventions for /home/phuth/Desktop/nest-fastify, a NestJS 11 + Fastify + Prisma 7 + nestjs-zod + Zod 4 + Biome + Jest + pnpm repository. Use when Codex is working in this repo on DTOs, feature modules, unit tests, TDD, code reviews, convention checks, controllers, services, repositories, Swagger decorators, Prisma access, or project architecture.
---

# Nest Fastify Project

## Overview

Use this skill when editing or reviewing the `nest-fastify` repository. It converts the project's Claude commands into Codex-readable workflows while preserving the repo's feature-first NestJS architecture, repository port pattern, Zod DTO rules, Swagger decorator rules, test placement, and review criteria.

## Reference Routing

Read only the reference needed for the task:

- For any code edit in this repo, read `references/conventions.md`.
- For DTO creation or DTO review, read `references/dto.md`.
- For feature module scaffolding, read `references/module.md` and `references/dto.md`.
- For creating unit tests or using TDD, read `references/testing-tdd.md`.
- For explicit code review or convention scan requests, read `references/review.md` and `references/conventions.md`.

If the user asks about library, framework, SDK, API, CLI, or cloud-service documentation, follow the active project instruction to use Context7 MCP before answering or coding from docs.

## Non-Negotiables

- Keep cross-module imports on aliases: `@common/*`, `@core/*`, `@modules/*`, `@generated/*`.
- Keep intra-module imports relative: `./`, `../dto/`, `../services/`.
- Do not use `../../../` for cross-module/layer imports.
- Do not create `index.ts` barrel files for modules.
- Services inject repository ports, not `PrismaService`.
- Only `<feature>.repository.prisma.ts` imports `PrismaService` and generated Prisma model types within a feature.
- Use `nestjs-zod` DTOs with the required double-cast `createZodDto` pattern.
- Use top-level `z.email()` for Zod 4 email validation.
- Use the mandated `z.any().transform(...)` pattern for `Date` fields in response DTOs, with the explanatory comment.
- Controllers do not import directly from `@nestjs/swagger`; Swagger metadata lives in module `decorators/`.
- Every HTTP route declares explicit `@HttpCode(HttpStatus.X)` matching the Swagger envelope status.
- Production code in `src/` must not use TypeScript `any` or `as any`.
- Use `@js-temporal/polyfill` for date/time logic. Do not use `new Date()` for date logic.
- Unit tests live under `test/unit/` mirroring `src/`, not colocated next to source files.

## Conflict Resolution

The source `.claude` commands had conflicting test placement guidance. Resolve it this way for Codex: unit specs live in `test/unit/` mirroring `src/`. This matches the dedicated `create-test` command and the current repository layout.

## Useful Commands

- `pnpm check`: format and lint with Biome write mode.
- `pnpm lint`: Biome check without writing.
- `pnpm test [path]`: run Jest tests.
- `pnpm build`: verify TypeScript/Nest build.
- `pnpm prisma:migrate && pnpm prisma:generate`: run after adding Prisma models.
