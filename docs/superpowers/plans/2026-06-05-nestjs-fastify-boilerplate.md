# NestJS + Fastify Boilerplate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold a NestJS 11 boilerplate on the Fastify adapter with PostgreSQL (Prisma), Redis + BullMQ, RabbitMQ, Zod validation (nestjs-zod), Swagger, JWT auth, organized into `core/` + `modules/`.

**Architecture:** A single hybrid Nest app: HTTP server via Fastify + an attached RabbitMQ microservice (`inheritAppConfig: true` so the global Zod pipe/serializer/filter apply to RMQ handlers too). `core/` holds infrastructure (config, prisma, queue, messaging, guards, filters, interceptors, decorators, health); `modules/` holds business features (users, auth, mail). Global `APP_PIPE`/`APP_INTERCEPTOR`/`APP_FILTER`/`APP_GUARD` wire validation, serialization, error handling and JWT protection. Public routes opt out via `@Public()`.

**Tech Stack:** NestJS 11, `@nestjs/platform-fastify`, Prisma + PostgreSQL, `@nestjs/bullmq` + BullMQ (Redis), `@nestjs/microservices` RMQ + amqplib + amqp-connection-manager, Zod v4 + nestjs-zod, `@nestjs/swagger` + `@fastify/static`, `@nestjs/jwt` + Passport JWT + bcrypt, pnpm, Biome, Docker Compose.

**Note on spec deviation:** The spec listed `core/config/configuration.ts` (namespaced config). To keep wiring simple (YAGNI) this plan consolidates config into `env.schema.ts` and reads values via `ConfigService.get(...)`. No separate `configuration.ts`.

---

## File Structure

```
.
├── biome.json
├── docker-compose.yml
├── .env.example
├── .env                         # local (gitignored)
├── nest-cli.json
├── package.json                 # rewritten
├── tsconfig.json                # rewritten
├── tsconfig.build.json
├── prisma/
│   └── schema.prisma
└── src/
    ├── main.ts
    ├── app.module.ts
    ├── core/
    │   ├── config/{config.module.ts,env.schema.ts}
    │   ├── prisma/{prisma.module.ts,prisma.service.ts}
    │   ├── queue/queue.module.ts
    │   ├── messaging/messaging.module.ts
    │   ├── filters/http-exception.filter.ts
    │   ├── interceptors/logging.interceptor.ts
    │   ├── guards/jwt-auth.guard.ts
    │   ├── health/health.controller.ts
    │   └── decorators/{public.decorator.ts,current-user.decorator.ts}
    └── modules/
        ├── users/{users.module.ts,users.controller.ts,users.service.ts,users.service.spec.ts}
        │   └── dto/{create-user.dto.ts,update-user.dto.ts,user-response.dto.ts}
        ├── auth/{auth.module.ts,auth.controller.ts,auth.service.ts,auth.service.spec.ts,jwt.strategy.ts}
        │   └── dto/{login.dto.ts,register.dto.ts}
        ├── mail/{mail.module.ts,mail.producer.ts,mail.processor.ts,mail.controller.ts}
        └── messaging/consumer/notifications.controller.ts
```

---

## Task 1: Project bootstrap (deps, tsconfig, nest-cli, biome, gitignore)

**Files:**
- Modify: `package.json` (rewrite scripts + deps)
- Create: `tsconfig.json`, `tsconfig.build.json`, `nest-cli.json`, `biome.json`
- Modify: `.gitignore`
- Delete: `src/index.ts`

- [ ] **Step 1: Remove the placeholder entrypoint**

```bash
git rm src/index.ts
```

- [ ] **Step 2: Install runtime dependencies with pnpm**

Run:
```bash
pnpm add @nestjs/common @nestjs/core @nestjs/platform-fastify @nestjs/config \
  @nestjs/swagger @nestjs/bullmq bullmq @nestjs/microservices amqplib amqp-connection-manager \
  @nestjs/jwt @nestjs/passport passport passport-jwt bcrypt \
  @prisma/client @fastify/static nestjs-zod zod reflect-metadata rxjs
```
Expected: pnpm adds packages and updates `pnpm-lock.yaml`.

- [ ] **Step 3: Install dev dependencies with pnpm**

Run:
```bash
pnpm add -D @nestjs/cli @nestjs/testing @nestjs/schematics prisma @biomejs/biome \
  typescript ts-node ts-jest jest @types/jest @types/node @types/passport-jwt @types/bcrypt \
  source-map-support tsconfig-paths
```
Expected: dev deps installed.

- [ ] **Step 4: Rewrite `package.json` scripts**

Replace the `"scripts"` block (and `main`) so it reads:

```json
{
  "name": "nest-fastify",
  "version": "1.0.0",
  "description": "",
  "main": "dist/main.js",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "start:prod": "node dist/main.js",
    "format": "biome format --write .",
    "lint": "biome check .",
    "check": "biome check --write .",
    "test": "jest",
    "prisma:generate": "prisma generate",
    "prisma:migrate": "prisma migrate dev",
    "prisma:deploy": "prisma migrate deploy"
  }
}
```
Keep the existing `dependencies`/`devDependencies` blocks that pnpm wrote.

- [ ] **Step 5: Create `tsconfig.json`**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2021",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strictNullChecks": true,
    "noImplicitAny": false,
    "strictBindCallApply": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "paths": {
      "@app/*": ["src/*"]
    }
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 6: Create `tsconfig.build.json`**

```json
{
  "extends": "./tsconfig.json",
  "exclude": ["node_modules", "dist", "test", "**/*spec.ts"]
}
```

- [ ] **Step 7: Create `nest-cli.json`**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 8: Create `biome.json`**

```json
{
  "$schema": "https://biomejs.dev/schemas/2.0.0/schema.json",
  "files": {
    "includes": ["src/**/*.ts", "*.json"],
    "ignoreUnknown": true
  },
  "formatter": {
    "enabled": true,
    "indentStyle": "space",
    "indentWidth": 2,
    "lineWidth": 100
  },
  "linter": {
    "enabled": true,
    "rules": {
      "recommended": true,
      "suspicious": {
        "noExplicitAny": "off"
      },
      "style": {
        "useImportType": "off"
      }
    }
  },
  "javascript": {
    "formatter": {
      "quoteStyle": "single",
      "trailingCommas": "all",
      "semicolons": "always"
    }
  }
}
```

> Note: `useImportType` is disabled because Nest's DI relies on runtime imports of decorated types; `noExplicitAny` is relaxed for pragmatic infra code.

- [ ] **Step 9: Append build/runtime ignores to `.gitignore`**

Add these lines if not already present:

```
node_modules
dist
.env
*.log
```

- [ ] **Step 10: Verify the toolchain installs and types resolve**

Run: `pnpm lint`
Expected: Biome runs (may report 0 files or formatting suggestions, no crash).

- [ ] **Step 11: Commit**

```bash
git add -A
git commit -m "chore: bootstrap nest+fastify toolchain (pnpm, biome, tsconfig)"
```

---

## Task 2: Docker Compose + environment files

**Files:**
- Create: `docker-compose.yml`, `.env.example`, `.env`

- [ ] **Step 1: Create `docker-compose.yml`**

```yaml
services:
  postgres:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: app
      POSTGRES_PASSWORD: app
      POSTGRES_DB: app
    ports:
      - '5432:5432'
    volumes:
      - pgdata:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    ports:
      - '6379:6379'

  rabbitmq:
    image: rabbitmq:3-management
    restart: unless-stopped
    ports:
      - '5672:5672'
      - '15672:15672'

volumes:
  pgdata:
```

- [ ] **Step 2: Create `.env.example`**

```dotenv
# App
NODE_ENV=development
PORT=3000

# Database (Prisma / PostgreSQL)
DATABASE_URL=postgresql://app:app@localhost:5432/app?schema=public

# Redis (BullMQ)
REDIS_HOST=localhost
REDIS_PORT=6379

# RabbitMQ
RABBITMQ_URL=amqp://guest:guest@localhost:5672
RABBITMQ_QUEUE=notifications_queue

# JWT
JWT_SECRET=change-me-in-production
JWT_EXPIRES_IN=3600s
```

- [ ] **Step 3: Create local `.env` (copy of example)**

Run: `cp .env.example .env`
Expected: `.env` exists (gitignored).

- [ ] **Step 4: Start infrastructure and verify it is reachable**

Run: `docker compose up -d && docker compose ps`
Expected: `postgres`, `redis`, `rabbitmq` all show `running`/healthy.

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml .env.example
git commit -m "chore: add docker-compose and env templates"
```

---

## Task 3: Core config (Zod env validation)

**Files:**
- Create: `src/core/config/env.schema.ts`, `src/core/config/config.module.ts`

- [ ] **Step 1: Create `src/core/config/env.schema.ts`**

```typescript
import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  RABBITMQ_URL: z.string().url(),
  RABBITMQ_QUEUE: z.string().default('notifications_queue'),

  JWT_SECRET: z.string().min(8),
  JWT_EXPIRES_IN: z.string().default('3600s'),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(config);
  if (!parsed.success) {
    throw new Error(`Invalid environment variables:\n${parsed.error.toString()}`);
  }
  return parsed.data;
}
```

- [ ] **Step 2: Create `src/core/config/config.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnv } from './env.schema';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
  ],
})
export class CoreConfigModule {}
```

- [ ] **Step 3: Verify it compiles**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors (other files don't exist yet; this file should type-check standalone).

- [ ] **Step 4: Commit**

```bash
git add src/core/config
git commit -m "feat(core): zod-validated config module"
```

---

## Task 4: Prisma (schema, service, module, migration)

**Files:**
- Create: `prisma/schema.prisma`, `src/core/prisma/prisma.service.ts`, `src/core/prisma/prisma.module.ts`

- [ ] **Step 1: Create `prisma/schema.prisma`**

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id        String   @id @default(uuid())
  email     String   @unique
  password  String
  name      String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

- [ ] **Step 2: Generate the Prisma client and run the first migration**

Run (requires `docker compose up -d` from Task 2):
```bash
pnpm prisma migrate dev --name init
```
Expected: migration `init` created under `prisma/migrations/`, client generated, "Your database is now in sync".

- [ ] **Step 3: Create `src/core/prisma/prisma.service.ts`**

```typescript
import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
```

- [ ] **Step 4: Create `src/core/prisma/prisma.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
```

- [ ] **Step 5: Verify it compiles**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add prisma src/core/prisma
git commit -m "feat(core): prisma module, User model, init migration"
```

---

## Task 5: Core cross-cutting (decorators, filter, interceptor, guard, health)

**Files:**
- Create: `src/core/decorators/public.decorator.ts`, `src/core/decorators/current-user.decorator.ts`
- Create: `src/core/filters/http-exception.filter.ts`
- Create: `src/core/interceptors/logging.interceptor.ts`
- Create: `src/core/guards/jwt-auth.guard.ts`
- Create: `src/core/health/health.controller.ts`

- [ ] **Step 1: Create `src/core/decorators/public.decorator.ts`**

```typescript
import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
```

- [ ] **Step 2: Create `src/core/decorators/current-user.decorator.ts`**

```typescript
import { type ExecutionContext, createParamDecorator } from '@nestjs/common';

export interface AuthUser {
  userId: string;
  email: string;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
```

- [ ] **Step 3: Create `src/core/guards/jwt-auth.guard.ts`**

```typescript
import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }
    return super.canActivate(context);
  }
}
```

- [ ] **Step 4: Create `src/core/filters/http-exception.filter.ts`**

```typescript
import { type ArgumentsHost, Catch, HttpException, Logger } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import { ZodSerializationException } from 'nestjs-zod';
import { ZodError } from 'zod';

@Catch(HttpException)
export class HttpExceptionFilter extends BaseExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: HttpException, host: ArgumentsHost): void {
    if (exception instanceof ZodSerializationException) {
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        this.logger.error(`ZodSerializationException: ${zodError.message}`);
      }
    }
    super.catch(exception, host);
  }
}
```

- [ ] **Step 5: Create `src/core/interceptors/logging.interceptor.ts`**

```typescript
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger(LoggingInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = context.switchToHttp().getRequest();
    const method = req?.method;
    const url = req?.url;
    const start = Date.now();
    return next.handle().pipe(
      tap(() => this.logger.log(`${method} ${url} - ${Date.now() - start}ms`)),
    );
  }
}
```

- [ ] **Step 6: Create `src/core/health/health.controller.ts`**

```typescript
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../decorators/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
```

- [ ] **Step 7: Verify it compiles**

Run: `pnpm exec tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add src/core/decorators src/core/guards src/core/filters src/core/interceptors src/core/health
git commit -m "feat(core): guards, filters, interceptors, decorators, health endpoint"
```

---

## Task 6: App module + bootstrap (Fastify + Swagger + RMQ hybrid)

This task wires globals and bootstrap, but queue/messaging/business modules don't exist yet. We add them to `app.module.ts` imports as they're built (Tasks 7-10). For now import only what exists so the app boots with `/health`.

**Files:**
- Create: `src/app.module.ts`, `src/main.ts`

- [ ] **Step 1: Create `src/app.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR, APP_PIPE } from '@nestjs/core';
import { ZodSerializerInterceptor, ZodValidationPipe } from 'nestjs-zod';
import { CoreConfigModule } from './core/config/config.module';
import { PrismaModule } from './core/prisma/prisma.module';
import { HttpExceptionFilter } from './core/filters/http-exception.filter';
import { JwtAuthGuard } from './core/guards/jwt-auth.guard';
import { HealthController } from './core/health/health.controller';

@Module({
  imports: [CoreConfigModule, PrismaModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
})
export class AppModule {}
```

- [ ] **Step 2: Create `src/main.ts`**

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { type MicroserviceOptions, Transport } from '@nestjs/microservices';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const config = app.get(ConfigService);

  app.enableCors();

  // Attach RabbitMQ microservice; inheritAppConfig so global pipe/serializer/filter apply.
  app.connectMicroservice<MicroserviceOptions>(
    {
      transport: Transport.RMQ,
      options: {
        urls: [config.getOrThrow<string>('RABBITMQ_URL')],
        queue: config.getOrThrow<string>('RABBITMQ_QUEUE'),
        queueOptions: { durable: true },
      },
    },
    { inheritAppConfig: true },
  );

  const openApiDoc = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Nest Fastify API')
      .setDescription('NestJS + Fastify boilerplate')
      .setVersion('1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, cleanupOpenApiDoc(openApiDoc));

  await app.startAllMicroservices();
  const port = config.getOrThrow<number>('PORT');
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`HTTP on :${port} | Swagger at /docs`);
}
bootstrap();
```

- [ ] **Step 3: Build**

Run: `pnpm build`
Expected: compiles to `dist/`, no errors.

- [ ] **Step 4: Boot and verify `/health` (requires docker compose up)**

Run:
```bash
pnpm start &
sleep 6
curl -s http://localhost:3000/health
kill %1
```
Expected: `{"status":"ok","timestamp":"..."}`.

- [ ] **Step 5: Commit**

```bash
git add src/app.module.ts src/main.ts
git commit -m "feat: app module + fastify bootstrap with swagger and RMQ hybrid"
```

---

## Task 7: Users module (Prisma CRUD + Zod DTOs + Swagger)

**Files:**
- Create: `src/modules/users/dto/create-user.dto.ts`, `update-user.dto.ts`, `user-response.dto.ts`
- Create: `src/modules/users/users.service.ts`, `users.service.spec.ts`
- Create: `src/modules/users/users.controller.ts`, `users.module.ts`
- Create: `jest.config.js`
- Modify: `src/app.module.ts` (add `UsersModule`)

- [ ] **Step 1: Create `jest.config.js`**

```javascript
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  testEnvironment: 'node',
};
```

- [ ] **Step 2: Create the DTOs**

`src/modules/users/dto/create-user.dto.ts`:
```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

export class CreateUserDto extends createZodDto(createUserSchema) {}
```

`src/modules/users/dto/update-user.dto.ts`:
```typescript
import { createZodDto } from 'nestjs-zod';
import { createUserSchema } from './create-user.dto';

export const updateUserSchema = createUserSchema.partial();

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
```

`src/modules/users/dto/user-response.dto.ts`:
```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// No `password` field — ZodSerializerInterceptor strips it from responses.
export const userResponseSchema = z.object({
  id: z.string(),
  email: z.string().email(),
  name: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export class UserResponseDto extends createZodDto(userResponseSchema) {}
```

- [ ] **Step 3: Write the failing test `src/modules/users/users.service.spec.ts`**

```typescript
import { Test } from '@nestjs/testing';
import { PrismaService } from '../../core/prisma/prisma.service';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findByEmail delegates to prisma.user.findUnique', async () => {
    const user = { id: '1', email: 'a@b.com', password: 'hash', name: null };
    prisma.user.findUnique.mockResolvedValue(user);
    const result = await service.findByEmail('a@b.com');
    expect(prisma.user.findUnique).toHaveBeenCalledWith({ where: { email: 'a@b.com' } });
    expect(result).toBe(user);
  });

  it('create passes data to prisma.user.create', async () => {
    const created = { id: '1', email: 'a@b.com', password: 'hash', name: 'A' };
    prisma.user.create.mockResolvedValue(created);
    const result = await service.create({ email: 'a@b.com', password: 'hash', name: 'A' });
    expect(prisma.user.create).toHaveBeenCalledWith({
      data: { email: 'a@b.com', password: 'hash', name: 'A' },
    });
    expect(result).toBe(created);
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm test users.service`
Expected: FAIL — `Cannot find module './users.service'`.

- [ ] **Step 5: Create `src/modules/users/users.service.ts`**

```typescript
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma, User } from '@prisma/client';
import { PrismaService } from '../../core/prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data });
  }

  async remove(id: string): Promise<User> {
    await this.findOne(id);
    return this.prisma.user.delete({ where: { id } });
  }
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test users.service`
Expected: PASS (2 tests).

- [ ] **Step 7: Create `src/modules/users/users.controller.ts`**

```typescript
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ZodResponse({ type: UserResponseDto })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  @ZodResponse({ type: [UserResponseDto] })
  findAll() {
    return this.users.findAll();
  }

  @Get(':id')
  @ZodResponse({ type: UserResponseDto })
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @ZodResponse({ type: UserResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @ZodResponse({ type: UserResponseDto })
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
```

> If `ZodResponse({ type: [UserResponseDto] })` (array form) is not supported by the installed nestjs-zod version, fall back to `@ApiOkResponse({ type: [UserResponseDto] })` + `@ZodSerializerDto(UserResponseDto)` on the `findAll` handler. Verify against the installed version's exports.

- [ ] **Step 8: Create `src/modules/users/users.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 9: Register `UsersModule` in `src/app.module.ts`**

Add the import and include it in `imports`:
```typescript
import { UsersModule } from './modules/users/users.module';
```
Change `imports: [CoreConfigModule, PrismaModule]` to:
```typescript
  imports: [CoreConfigModule, PrismaModule, UsersModule],
```

- [ ] **Step 10: Build and verify password never leaks**

Run:
```bash
pnpm build
pnpm start &
sleep 6
curl -s -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"a@b.com","password":"password123","name":"A"}'
kill %1
```
Expected: JSON user object containing `id`, `email`, `name` but **no `password`** field.

- [ ] **Step 11: Commit**

```bash
git add src/modules/users src/app.module.ts jest.config.js
git commit -m "feat(users): CRUD with zod DTOs, password-safe responses, unit tests"
```

---

## Task 8: Auth module (Passport JWT)

**Files:**
- Create: `src/modules/auth/dto/register.dto.ts`, `login.dto.ts`
- Create: `src/modules/auth/auth.service.ts`, `auth.service.spec.ts`
- Create: `src/modules/auth/jwt.strategy.ts`
- Create: `src/modules/auth/auth.controller.ts`, `auth.module.ts`
- Modify: `src/app.module.ts` (add `AuthModule`)

- [ ] **Step 1: Create the DTOs**

`src/modules/auth/dto/register.dto.ts`:
```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1).optional(),
});

export class RegisterDto extends createZodDto(registerSchema) {}
```

`src/modules/auth/dto/login.dto.ts`:
```typescript
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
});

export class LoginDto extends createZodDto(loginSchema) {}
```

- [ ] **Step 2: Write the failing test `src/modules/auth/auth.service.spec.ts`**

```typescript
import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { AuthService } from './auth.service';

describe('AuthService', () => {
  let service: AuthService;
  const users = { findByEmail: jest.fn(), create: jest.fn() };
  const jwt = { signAsync: jest.fn().mockResolvedValue('signed.jwt.token') };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: UsersService, useValue: users },
        { provide: JwtService, useValue: jwt },
      ],
    }).compile();
    service = moduleRef.get(AuthService);
  });

  it('login returns an access token for valid credentials', async () => {
    const hash = await bcrypt.hash('password123', 10);
    users.findByEmail.mockResolvedValue({ id: '1', email: 'a@b.com', password: hash, name: 'A' });
    const result = await service.login({ email: 'a@b.com', password: 'password123' });
    expect(result).toEqual({ accessToken: 'signed.jwt.token' });
    expect(jwt.signAsync).toHaveBeenCalledWith({ sub: '1', email: 'a@b.com' });
  });

  it('login throws Unauthorized for wrong password', async () => {
    const hash = await bcrypt.hash('password123', 10);
    users.findByEmail.mockResolvedValue({ id: '1', email: 'a@b.com', password: hash, name: 'A' });
    await expect(service.login({ email: 'a@b.com', password: 'wrongpass' })).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test auth.service`
Expected: FAIL — `Cannot find module './auth.service'`.

- [ ] **Step 4: Create `src/modules/auth/auth.service.ts`**

```typescript
import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) {
      throw new ConflictException('Email already registered');
    }
    const password = await bcrypt.hash(dto.password, 10);
    return this.users.create({ email: dto.email, password, name: dto.name });
  }

  async login(dto: LoginDto): Promise<{ accessToken: string }> {
    const user = await this.users.findByEmail(dto.email);
    if (!user || !(await bcrypt.compare(dto.password, user.password))) {
      throw new UnauthorizedException('Invalid credentials');
    }
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email });
    return { accessToken };
  }
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test auth.service`
Expected: PASS (2 tests).

- [ ] **Step 6: Create `src/modules/auth/jwt.strategy.ts`**

```typescript
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { AuthUser } from '../../core/decorators/current-user.decorator';

interface JwtPayload {
  sub: string;
  email: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_SECRET'),
    });
  }

  validate(payload: JwtPayload): AuthUser {
    return { userId: payload.sub, email: payload.email };
  }
}
```

- [ ] **Step 7: Create `src/modules/auth/auth.controller.ts`**

```typescript
import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodResponse } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../../core/decorators/current-user.decorator';
import { Public } from '../../core/decorators/public.decorator';
import { UserResponseDto } from '../users/dto/user-response.dto';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ZodResponse({ type: UserResponseDto })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
```

- [ ] **Step 8: Create `src/modules/auth/auth.module.ts`**

```typescript
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.getOrThrow<string>('JWT_EXPIRES_IN') },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
})
export class AuthModule {}
```

- [ ] **Step 9: Register `AuthModule` in `src/app.module.ts`**

Add:
```typescript
import { AuthModule } from './modules/auth/auth.module';
```
Update imports to:
```typescript
  imports: [CoreConfigModule, PrismaModule, UsersModule, AuthModule],
```

- [ ] **Step 10: Build and verify the auth flow end-to-end**

Run:
```bash
pnpm build
pnpm start &
sleep 6
curl -s -X POST http://localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d '{"email":"login@b.com","password":"password123","name":"L"}'
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"login@b.com","password":"password123"}' | sed -E 's/.*"accessToken":"([^"]+)".*/\1/')
echo "TOKEN=$TOKEN"
curl -s http://localhost:3000/auth/me -H "Authorization: Bearer $TOKEN"
echo
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/auth/me
kill %1
```
Expected: register returns user (no password); `me` with token returns `{"userId":...,"email":"login@b.com"}`; `me` without token returns `401`.

- [ ] **Step 11: Commit**

```bash
git add src/modules/auth src/app.module.ts
git commit -m "feat(auth): passport-jwt register/login/me with global guard"
```

---

## Task 9: Queue (BullMQ) + mail module (producer + processor)

**Files:**
- Create: `src/core/queue/queue.module.ts`
- Create: `src/modules/mail/mail.producer.ts`, `mail.processor.ts`, `mail.controller.ts`, `mail.module.ts`
- Modify: `src/app.module.ts` (add `QueueModule`, `MailModule`)

- [ ] **Step 1: Create `src/core/queue/queue.module.ts`**

```typescript
import { BullModule } from '@nestjs/bullmq';
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Global()
@Module({
  imports: [
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.getOrThrow<string>('REDIS_HOST'),
          port: config.getOrThrow<number>('REDIS_PORT'),
        },
      }),
    }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
```

- [ ] **Step 2: Create `src/modules/mail/mail.producer.ts`**

```typescript
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';

export interface SendMailJob {
  to: string;
  subject: string;
  body: string;
}

@Injectable()
export class MailProducer {
  constructor(@InjectQueue('mail') private readonly queue: Queue) {}

  async enqueue(data: SendMailJob): Promise<string> {
    const job = await this.queue.add('send', data, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
    return job.id as string;
  }
}
```

- [ ] **Step 3: Create `src/modules/mail/mail.processor.ts`**

```typescript
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SendMailJob } from './mail.producer';

@Processor('mail')
export class MailProcessor extends WorkerHost {
  private readonly logger = new Logger(MailProcessor.name);

  async process(job: Job<SendMailJob>): Promise<{ delivered: boolean }> {
    this.logger.log(`Sending mail to ${job.data.to}: ${job.data.subject}`);
    // Simulated send. Replace with a real transport in production.
    return { delivered: true };
  }
}
```

- [ ] **Step 4: Create `src/modules/mail/mail.controller.ts`**

```typescript
import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { Public } from '../../core/decorators/public.decorator';
import { MailProducer } from './mail.producer';

const sendMailSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});
class SendMailDto extends createZodDto(sendMailSchema) {}

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly producer: MailProducer) {}

  @Public()
  @Post('test')
  async test(@Body() dto: SendMailDto) {
    const jobId = await this.producer.enqueue(dto);
    return { enqueued: true, jobId };
  }
}
```

- [ ] **Step 5: Create `src/modules/mail/mail.module.ts`**

```typescript
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailController } from './mail.controller';
import { MailProcessor } from './mail.processor';
import { MailProducer } from './mail.producer';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  controllers: [MailController],
  providers: [MailProducer, MailProcessor],
  exports: [MailProducer],
})
export class MailModule {}
```

- [ ] **Step 6: Register `QueueModule` and `MailModule` in `src/app.module.ts`**

Add imports:
```typescript
import { QueueModule } from './core/queue/queue.module';
import { MailModule } from './modules/mail/mail.module';
```
Update imports array to:
```typescript
  imports: [CoreConfigModule, PrismaModule, QueueModule, UsersModule, AuthModule, MailModule],
```

- [ ] **Step 7: Build and verify a job is enqueued and processed (requires redis up)**

Run:
```bash
pnpm build
pnpm start &
sleep 6
curl -s -X POST http://localhost:3000/mail/test -H 'Content-Type: application/json' \
  -d '{"to":"x@y.com","subject":"Hi","body":"Hello"}'
sleep 2
kill %1
```
Expected: response `{"enqueued":true,"jobId":"..."}` and a log line `Sending mail to x@y.com: Hi` from `MailProcessor`.

- [ ] **Step 8: Commit**

```bash
git add src/core/queue src/modules/mail src/app.module.ts
git commit -m "feat(queue): bullmq root + mail producer/processor demo"
```

---

## Task 10: RabbitMQ messaging (producer client + consumer)

**Files:**
- Create: `src/core/messaging/messaging.module.ts`
- Create: `src/modules/messaging/consumer/notifications.controller.ts`
- Modify: `src/app.module.ts` (add `MessagingModule` + register the consumer controller's module)

- [ ] **Step 1: Create `src/core/messaging/messaging.module.ts`**

```typescript
import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ClientsModule, Transport } from '@nestjs/microservices';

export const RMQ_CLIENT = 'RMQ_CLIENT';

@Global()
@Module({
  imports: [
    ClientsModule.registerAsync([
      {
        name: RMQ_CLIENT,
        inject: [ConfigService],
        useFactory: (config: ConfigService) => ({
          transport: Transport.RMQ,
          options: {
            urls: [config.getOrThrow<string>('RABBITMQ_URL')],
            queue: config.getOrThrow<string>('RABBITMQ_QUEUE'),
            queueOptions: { durable: true },
          },
        }),
      },
    ]),
  ],
  exports: [ClientsModule],
})
export class MessagingModule {}
```

- [ ] **Step 2: Create the consumer module + controller**

`src/modules/messaging/consumer/notifications.controller.ts`:
```typescript
import { Controller, Inject, Logger } from '@nestjs/common';
import { type ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { ApiExcludeController } from '@nestjs/swagger';
import { Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../core/decorators/public.decorator';
import { RMQ_CLIENT } from '../../../core/messaging/messaging.module';

interface NotificationCreated {
  userId: string;
  message: string;
}

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(@Inject(RMQ_CLIENT) private readonly client: ClientProxy) {}

  // HTTP endpoint that publishes an event to RabbitMQ (demo producer).
  @Public()
  @Post('publish')
  publish() {
    const payload: NotificationCreated = { userId: 'demo', message: 'hello from http' };
    this.client.emit('notification.created', payload);
    return { published: true };
  }

  // RabbitMQ consumer (demo). Runs in the attached microservice.
  @EventPattern('notification.created')
  handleCreated(@Payload() data: NotificationCreated): void {
    this.logger.log(`Received notification.created for user=${data.userId}: ${data.message}`);
  }
}
```

> Note: `@ApiExcludeController` is imported but the controller exposes one documented HTTP route, so do NOT apply `@ApiExcludeController`. Remove the unused import if Biome flags it: keep only `ApiTags`. (Listed here so the engineer knows it's intentional to document the `publish` route.)

`src/modules/messaging/consumer/notifications.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';

@Module({
  controllers: [NotificationsController],
})
export class NotificationsModule {}
```

- [ ] **Step 3: Clean up the unused import in the controller**

Edit `notifications.controller.ts`: remove `ApiExcludeController` from the `@nestjs/swagger` import and consolidate imports so only `Controller, Inject, Logger, Post` (from `@nestjs/common`) and `ApiTags` (from `@nestjs/swagger`) and the microservices/decorator imports remain. Final import block:

```typescript
import { Controller, Inject, Logger, Post } from '@nestjs/common';
import { type ClientProxy, EventPattern, Payload } from '@nestjs/microservices';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../core/decorators/public.decorator';
import { RMQ_CLIENT } from '../../../core/messaging/messaging.module';
```

- [ ] **Step 4: Register modules in `src/app.module.ts`**

Add imports:
```typescript
import { MessagingModule } from './core/messaging/messaging.module';
import { NotificationsModule } from './modules/messaging/consumer/notifications.module';
```
Update imports array to:
```typescript
  imports: [
    CoreConfigModule,
    PrismaModule,
    QueueModule,
    MessagingModule,
    UsersModule,
    AuthModule,
    MailModule,
    NotificationsModule,
  ],
```

- [ ] **Step 5: Build and verify publish→consume round-trip (requires rabbitmq up)**

Run:
```bash
pnpm build
pnpm start &
sleep 6
curl -s -X POST http://localhost:3000/notifications/publish
sleep 2
kill %1
```
Expected: response `{"published":true}` and a log line `Received notification.created for user=demo: hello from http` from `NotificationsController`.

- [ ] **Step 6: Commit**

```bash
git add src/core/messaging src/modules/messaging src/app.module.ts
git commit -m "feat(messaging): rabbitmq client + consumer demo (publish/consume)"
```

---

## Task 11: Final verification, format, and README pointer

**Files:**
- Create: `README.md`

- [ ] **Step 1: Run the full test suite**

Run: `pnpm test`
Expected: all suites pass (UsersService + AuthService).

- [ ] **Step 2: Run Biome and auto-fix formatting**

Run: `pnpm check`
Expected: Biome writes formatting fixes; re-run `pnpm lint` → no errors.

- [ ] **Step 3: Full production build**

Run: `pnpm build`
Expected: `dist/` produced, no TypeScript errors.

- [ ] **Step 4: End-to-end smoke against running infra**

Run:
```bash
docker compose up -d
pnpm start &
sleep 6
curl -s http://localhost:3000/health
curl -s -o /dev/null -w 'docs:%{http_code}\n' http://localhost:3000/docs
kill %1
```
Expected: `/health` returns ok JSON; `/docs` returns `200`.

- [ ] **Step 5: Create `README.md`**

```markdown
# nest-fastify

NestJS 11 (Fastify) boilerplate: PostgreSQL (Prisma), Redis + BullMQ, RabbitMQ,
Zod validation (nestjs-zod), Swagger, JWT auth. Package manager: **pnpm**.

## Quick start

```bash
pnpm install
cp .env.example .env
docker compose up -d
pnpm prisma:migrate
pnpm start:dev
```

- API: http://localhost:3000
- Swagger: http://localhost:3000/docs
- RabbitMQ UI: http://localhost:15672 (guest/guest)

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm start:dev` | Run with watch |
| `pnpm build` | Production build |
| `pnpm test` | Unit tests (Jest) |
| `pnpm lint` | Biome check |
| `pnpm check` | Biome check + autofix |
| `pnpm prisma:migrate` | Run dev migration |

## Structure

- `src/core/` — infrastructure (config, prisma, queue, messaging, guards, filters, interceptors, health)
- `src/modules/` — business features (users, auth, mail, messaging consumer)
```

- [ ] **Step 6: Final commit**

```bash
git add README.md
git commit -m "docs: add README and finalize boilerplate"
```

---

## Self-Review

**Spec coverage:**
- Fastify adapter → Task 6 ✓
- PostgreSQL + Prisma → Task 4 ✓
- Redis + BullMQ → Task 9 ✓
- RabbitMQ → Task 10 + Task 6 (hybrid attach) ✓
- Zod + nestjs-zod (pipe/serializer/filter, createZodDto, cleanupOpenApiDoc) → Tasks 1/5/6/7 ✓
- Swagger + `@fastify/static` → Tasks 1/6 ✓
- Auth Passport JWT + global APP_GUARD + `@Public` → Tasks 5/6/8 ✓
- `UserResponseDto` password-safe + `@ZodResponse` → Tasks 7/8 ✓
- `inheritAppConfig: true` → Task 6 ✓
- `amqp-connection-manager` installed → Task 1 ✓
- Health endpoint → Task 5 ✓
- core/ + modules/ structure → all tasks ✓
- Docker Compose → Task 2 ✓
- Biome (not ESLint/Prettier) → Task 1 ✓
- pnpm only → all tasks ✓
- Env validated by Zod (fail-fast) → Task 3 ✓

**Deviations flagged:** `configuration.ts` consolidated into `env.schema.ts` (noted in header).

**Version-sensitive verification points** (engineer must confirm against installed versions): `@ZodResponse` array form in Task 7 (fallback provided); `cleanupOpenApiDoc` / `ZodSerializerInterceptor` / `ZodSerializationException` exports from `nestjs-zod`.
```
