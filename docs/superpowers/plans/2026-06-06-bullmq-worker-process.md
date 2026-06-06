# BullMQ Worker — process/cổng độc lập — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tách worker BullMQ ra một Nest Fastify process riêng (cổng 3001) với Bull Board UI có Basic Auth, biến process API thành thuần producer.

**Architecture:** Một codebase, hai entrypoint. `main.ts`/`AppModule` (HTTP :3000) chỉ enqueue. `main.worker.ts`/`WorkerModule` (Fastify :3001) chạy các `@Processor`, expose `/health` (tái dùng `HealthController`) và Bull Board `/admin/queues`. Auth Bull Board bằng Fastify `onRequest` hook gắn vào instance trước khi Nest init. Worker không import `PrismaModule` (không mở kết nối DB).

**Tech Stack:** NestJS 11, `@nestjs/platform-fastify` (Fastify 5), `@nestjs/bullmq` + BullMQ, `@bull-board/nestjs` + `@bull-board/fastify` + `@bull-board/api`, ioredis, Zod 4, Jest + @swc/jest, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-06-bullmq-worker-process-design.md`

---

## File Structure

**Tạo mới:**
- `src/common/auth/basic-auth.ts` — `verifyBasicAuth()` (thuần) + `createBullBoardAuthHook()` (factory hook Fastify).
- `src/modules/mail/mail-worker.module.ts` — phía worker của mail: `registerQueue('mail')` + Bull Board `forFeature` + `MailProcessor`.
- `src/worker.module.ts` — root module worker process.
- `src/main.worker.ts` — bootstrap worker process.
- `jest.e2e.config.js` — Jest config riêng cho e2e (`*.e2e-spec.ts`).
- Tests: `test/unit/core/config/env.schema.spec.ts`, `test/unit/common/auth/basic-auth.spec.ts`, `test/unit/modules/mail/jobs/mail.processor.spec.ts`, `test/unit/modules/mail/jobs/mail.producer.spec.ts`, `test/e2e/worker-bull-board.e2e-spec.ts`.

**Sửa:**
- `src/core/config/env.schema.ts` — thêm field worker + `.superRefine` ép `BULLBOARD_PASSWORD` ở production.
- `src/modules/mail/jobs/mail.processor.ts` — thêm `concurrency` từ env.
- `src/modules/mail/mail.module.ts` — bỏ `MailProcessor` (API thuần producer).
- `package.json` — scripts worker + `test:e2e` + deps Bull Board.

---

## Task 1: Cài deps + env schema cho worker

**Files:**
- Modify: `package.json` (dependencies)
- Modify: `src/core/config/env.schema.ts`
- Test: `test/unit/core/config/env.schema.spec.ts`

- [ ] **Step 1: Cài các package Bull Board**

Run:
```bash
pnpm add @bull-board/nestjs @bull-board/api @bull-board/fastify
```
Expected: 3 package được thêm vào `dependencies`, `pnpm-lock.yaml` cập nhật. (KHÔNG cài `fastify-basic-auth` — auth tự viết.)

- [ ] **Step 2: Viết test thất bại cho validateEnv**

Tạo `test/unit/core/config/env.schema.spec.ts`:
```ts
import { validateEnv } from '@core/config/env.schema';

// Env tối thiểu hợp lệ (các field required của schema hiện có).
function baseEnv(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    DATABASE_URL: 'postgres://u:p@localhost:5432/app',
    RABBITMQ_URL: 'amqp://localhost:5672',
    JWT_SECRET: 'supersecret',
    ...overrides,
  };
}

describe('validateEnv — worker fields', () => {
  it('áp default cho WORKER_PORT và MAIL_WORKER_CONCURRENCY', () => {
    const env = validateEnv(baseEnv());
    expect(env.WORKER_PORT).toBe(3001);
    expect(env.MAIL_WORKER_CONCURRENCY).toBe(5);
    expect(env.BULLBOARD_USER).toBe('admin');
  });

  it('cho phép thiếu BULLBOARD_PASSWORD khi KHÔNG phải production', () => {
    const env = validateEnv(baseEnv({ NODE_ENV: 'development' }));
    expect(env.BULLBOARD_PASSWORD).toBeUndefined();
  });

  it('BẮT BUỘC BULLBOARD_PASSWORD khi production', () => {
    expect(() => validateEnv(baseEnv({ NODE_ENV: 'production' }))).toThrow(/BULLBOARD_PASSWORD/);
  });

  it('production hợp lệ khi có BULLBOARD_PASSWORD', () => {
    const env = validateEnv(baseEnv({ NODE_ENV: 'production', BULLBOARD_PASSWORD: 'strong' }));
    expect(env.BULLBOARD_PASSWORD).toBe('strong');
  });
});
```

- [ ] **Step 3: Chạy test để xác nhận FAIL**

Run: `pnpm jest test/unit/core/config/env.schema.spec.ts`
Expected: FAIL — `WORKER_PORT` undefined / không throw cho production (field chưa tồn tại).

- [ ] **Step 4: Thêm field + superRefine vào schema**

Trong `src/core/config/env.schema.ts`, thêm các field này vào trong `z.object({...})` (đặt ngay sau `FALLBACK_LANGUAGE`):
```ts
  // ── Worker process (BullMQ) ────────────────────────────────────────────
  // Cổng HTTP của worker process (health + Bull Board). Độc lập với PORT của API.
  WORKER_PORT: z.coerce.number().int().positive().default(3001),
  // Số job chạy song song của worker mail.
  MAIL_WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  // Basic Auth cho Bull Board UI.
  BULLBOARD_USER: z.string().default('admin'),
  // KHÔNG default — tránh credential mặc định lọt vào production (worker bind 0.0.0.0).
  // Bắt buộc ở production qua superRefine bên dưới.
  BULLBOARD_PASSWORD: z.string().optional(),
```

Sửa phần đóng `z.object` để thêm `.superRefine`. Đổi:
```ts
});

export type Env = z.infer<typeof envSchema>;
```
thành:
```ts
}).superRefine((env, ctx) => {
  // Bull Board lộ payload job → ở production không cho phép thiếu mật khẩu.
  if (env.NODE_ENV === 'production' && !env.BULLBOARD_PASSWORD) {
    ctx.addIssue({
      code: 'custom',
      path: ['BULLBOARD_PASSWORD'],
      message: 'BULLBOARD_PASSWORD là bắt buộc ở production.',
    });
  }
});

export type Env = z.infer<typeof envSchema>;
```

> Lưu ý: `export const envSchema = z.object({...})` đổi thành `z.object({...}).superRefine(...)`. `z.infer` và `validateEnv` (dùng `safeParse` + `z.prettifyError`) vẫn hoạt động bình thường với `ZodEffects`.

- [ ] **Step 5: Chạy test để xác nhận PASS**

Run: `pnpm jest test/unit/core/config/env.schema.spec.ts`
Expected: PASS (4 test).

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml src/core/config/env.schema.ts test/unit/core/config/env.schema.spec.ts
git commit -m "feat(worker): env fields + bắt buộc BULLBOARD_PASSWORD ở production"
```

---

## Task 2: Helper Basic Auth + hook factory

**Files:**
- Create: `src/common/auth/basic-auth.ts`
- Test: `test/unit/common/auth/basic-auth.spec.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `test/unit/common/auth/basic-auth.spec.ts`:
```ts
import { createBullBoardAuthHook, verifyBasicAuth } from '@common/auth/basic-auth';

const b64 = (s: string) => Buffer.from(s).toString('base64');

describe('verifyBasicAuth', () => {
  it('false khi thiếu header', () => {
    expect(verifyBasicAuth(undefined, 'admin', 'pw')).toBe(false);
  });
  it('false khi không phải scheme Basic', () => {
    expect(verifyBasicAuth('Bearer xyz', 'admin', 'pw')).toBe(false);
  });
  it('false khi sai mật khẩu', () => {
    expect(verifyBasicAuth(`Basic ${b64('admin:wrong')}`, 'admin', 'pw')).toBe(false);
  });
  it('true khi đúng user:pass', () => {
    expect(verifyBasicAuth(`Basic ${b64('admin:pw')}`, 'admin', 'pw')).toBe(true);
  });
});

describe('createBullBoardAuthHook', () => {
  function fakeReply() {
    const reply: any = {};
    reply.header = jest.fn().mockReturnValue(reply);
    reply.code = jest.fn().mockReturnValue(reply);
    reply.send = jest.fn().mockReturnValue(reply);
    return reply;
  }

  it('bỏ qua route ngoài prefix (gọi done, không đụng reply)', () => {
    const hook = createBullBoardAuthHook('/admin/queues', 'admin', 'pw');
    const done = jest.fn();
    const reply = fakeReply();
    hook({ url: '/health', headers: {} } as any, reply, done);
    expect(done).toHaveBeenCalledWith();
    expect(reply.code).not.toHaveBeenCalled();
  });

  it('401 khi route trong prefix mà thiếu auth', () => {
    const hook = createBullBoardAuthHook('/admin/queues', 'admin', 'pw');
    const done = jest.fn();
    const reply = fakeReply();
    hook({ url: '/admin/queues', headers: {} } as any, reply, done);
    expect(reply.code).toHaveBeenCalledWith(401);
    expect(reply.header).toHaveBeenCalledWith('WWW-Authenticate', 'Basic realm="Bull Board"');
    expect(done).not.toHaveBeenCalled();
  });

  it('cho qua khi route trong prefix và auth đúng', () => {
    const hook = createBullBoardAuthHook('/admin/queues', 'admin', 'pw');
    const done = jest.fn();
    const reply = fakeReply();
    hook(
      { url: '/admin/queues/api', headers: { authorization: `Basic ${b64('admin:pw')}` } } as any,
      reply,
      done,
    );
    expect(done).toHaveBeenCalledWith();
    expect(reply.code).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận FAIL**

Run: `pnpm jest test/unit/common/auth/basic-auth.spec.ts`
Expected: FAIL — module `@common/auth/basic-auth` chưa tồn tại.

- [ ] **Step 3: Viết implementation tối thiểu**

Tạo `src/common/auth/basic-auth.ts`:
```ts
import type { FastifyReply, FastifyRequest } from 'fastify';

// Kiểm tra header `Authorization: Basic <base64(user:pass)>`. Thuần, không phụ thuộc framework.
export function verifyBasicAuth(
  header: string | undefined,
  expectedUser: string,
  expectedPass: string,
): boolean {
  if (!header?.startsWith('Basic ')) return false;
  const decoded = Buffer.from(header.slice('Basic '.length), 'base64').toString('utf8');
  const sep = decoded.indexOf(':');
  if (sep === -1) return false;
  return decoded.slice(0, sep) === expectedUser && decoded.slice(sep + 1) === expectedPass;
}

// Tạo Fastify onRequest hook chỉ chặn các request có URL bắt đầu bằng `routePrefix`
// (route Bull Board). Hook ở root instance chạy cho MỌI route kể cả route do plugin tạo.
export function createBullBoardAuthHook(routePrefix: string, user: string, pass: string) {
  return (req: FastifyRequest, reply: FastifyReply, done: (err?: Error) => void): void => {
    if (!req.url.startsWith(routePrefix)) return done();
    if (verifyBasicAuth(req.headers.authorization, user, pass)) return done();
    reply.header('WWW-Authenticate', 'Basic realm="Bull Board"').code(401).send();
  };
}
```

- [ ] **Step 4: Chạy test để xác nhận PASS**

Run: `pnpm jest test/unit/common/auth/basic-auth.spec.ts`
Expected: PASS (7 test).

- [ ] **Step 5: Commit**

```bash
git add src/common/auth/basic-auth.ts test/unit/common/auth/basic-auth.spec.ts
git commit -m "feat(worker): helper Basic Auth + Fastify hook cho Bull Board"
```

---

## Task 3: MailProcessor — thêm concurrency

**Files:**
- Modify: `src/modules/mail/jobs/mail.processor.ts`
- Test: `test/unit/modules/mail/jobs/mail.processor.spec.ts`

- [ ] **Step 1: Viết test thất bại**

Tạo `test/unit/modules/mail/jobs/mail.processor.spec.ts`:
```ts
import { MailProcessor } from '@modules/mail/jobs/mail.processor';

describe('MailProcessor', () => {
  beforeEach(() => jest.clearAllMocks());

  it('process() trả { delivered: true }', async () => {
    const processor = new MailProcessor();
    const job: any = { data: { to: 'a@b.com', subject: 'Hi', body: 'x' } };
    await expect(processor.process(job)).resolves.toEqual({ delivered: true });
  });
});
```

- [ ] **Step 2: Chạy test để xác nhận PASS (baseline) rồi sửa decorator**

Run: `pnpm jest test/unit/modules/mail/jobs/mail.processor.spec.ts`
Expected: PASS (hành vi `process()` chưa đổi). Đây là test bảo vệ hành vi trước khi thêm concurrency.

- [ ] **Step 3: Thêm concurrency vào decorator**

Sửa `src/modules/mail/jobs/mail.processor.ts`, đổi dòng `@Processor('mail')` thành:
```ts
// Đối số thứ 2 là WorkerOptions của BullMQ. Đọc process.env trực tiếp vì ConfigService
// chưa khả dụng lúc decorate class (ngoại lệ có chủ đích — giống các nơi cần config tại
// thời điểm decoration). Concurrency chỉ vô hiệu khi nhiều consumer cùng 1 queue; ở đây 1.
@Processor('mail', { concurrency: Number(process.env.MAIL_WORKER_CONCURRENCY ?? 5) })
```

- [ ] **Step 4: Chạy lại test để xác nhận vẫn PASS**

Run: `pnpm jest test/unit/modules/mail/jobs/mail.processor.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/mail/jobs/mail.processor.ts test/unit/modules/mail/jobs/mail.processor.spec.ts
git commit -m "feat(worker): MailProcessor concurrency từ env"
```

---

## Task 4: MailProducer — test bao phủ enqueue

**Files:**
- Test: `test/unit/modules/mail/jobs/mail.producer.spec.ts`

- [ ] **Step 1: Viết test**

Tạo `test/unit/modules/mail/jobs/mail.producer.spec.ts`:
```ts
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { MailProducer } from '@modules/mail/jobs/mail.producer';

describe('MailProducer', () => {
  const add = jest.fn();
  let producer: MailProducer;

  beforeEach(async () => {
    jest.clearAllMocks();
    add.mockResolvedValue({ id: 'job-1' });
    const moduleRef = await Test.createTestingModule({
      providers: [MailProducer, { provide: getQueueToken('mail'), useValue: { add } }],
    }).compile();
    producer = moduleRef.get(MailProducer);
  });

  it('enqueue() gọi queue.add đúng tham số và trả job id', async () => {
    const dto = { to: 'a@b.com', subject: 'Hi', body: 'x' };
    const id = await producer.enqueue(dto);
    expect(add).toHaveBeenCalledWith('send', dto, {
      attempts: 3,
      backoff: { type: 'exponential', delay: 1000 },
      removeOnComplete: true,
    });
    expect(id).toBe('job-1');
  });
});
```

- [ ] **Step 2: Chạy test**

Run: `pnpm jest test/unit/modules/mail/jobs/mail.producer.spec.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add test/unit/modules/mail/jobs/mail.producer.spec.ts
git commit -m "test(worker): bao phủ MailProducer.enqueue"
```

---

## Task 5: API thuần producer + MailWorkerModule

**Files:**
- Modify: `src/modules/mail/mail.module.ts`
- Create: `src/modules/mail/mail-worker.module.ts`

- [ ] **Step 1: Bỏ MailProcessor khỏi MailModule (API)**

Sửa `src/modules/mail/mail.module.ts` thành:
```ts
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailController } from './controllers/mail.controller';
import { MailProducer } from './jobs/mail.producer';

@Module({
  imports: [BullModule.registerQueue({ name: 'mail' })],
  controllers: [MailController],
  providers: [MailProducer],
  exports: [MailProducer],
})
export class MailModule {}
```
(Đã bỏ import và provider `MailProcessor` — API không còn chạy worker.)

- [ ] **Step 2: Tạo MailWorkerModule (phía worker)**

Tạo `src/modules/mail/mail-worker.module.ts`:
```ts
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { BullBoardModule } from '@bull-board/nestjs';
import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { MailProcessor } from './jobs/mail.processor';

// Phía worker của feature mail: đăng ký queue (để Bull Board introspect được), gắn queue
// vào Bull Board, và chạy processor. KHÔNG import PrismaModule — MailProcessor không dùng DB.
@Module({
  imports: [
    BullModule.registerQueue({ name: 'mail' }),
    BullBoardModule.forFeature({ name: 'mail', adapter: BullMQAdapter }),
  ],
  providers: [MailProcessor],
})
export class MailWorkerModule {}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm typecheck`
Expected: PASS (không lỗi type). Nếu `@bull-board/*` báo thiếu type, kiểm tra đã cài ở Task 1.

- [ ] **Step 4: Commit**

```bash
git add src/modules/mail/mail.module.ts src/modules/mail/mail-worker.module.ts
git commit -m "feat(worker): API thuần producer + MailWorkerModule"
```

---

## Task 6: WorkerModule (root module worker process)

**Files:**
- Create: `src/worker.module.ts`

- [ ] **Step 1: Tạo WorkerModule**

Tạo `src/worker.module.ts`:
```ts
import { FastifyAdapter } from '@bull-board/fastify';
import { BullBoardModule } from '@bull-board/nestjs';
import { Module } from '@nestjs/common';
import { CoreConfigModule } from '@core/config/config.module';
import { HealthController } from '@core/health/health.controller';
import { LoggerModule } from '@core/logger/logger.module';
import { QueueModule } from '@core/queue/queue.module';
import { RedisModule } from '@core/redis/redis.module';
import { MailWorkerModule } from '@modules/mail/mail-worker.module';

// Root module của worker process. Chỉ nạp hạ tầng worker CẦN: config/logger/redis/queue.
// KHÔNG import PrismaModule (không mở kết nối DB) và KHÔNG import MessagingModule (không RMQ).
// Auth Bull Board làm bằng Fastify onRequest hook ở main.worker.ts (không qua Nest middleware).
@Module({
  imports: [
    CoreConfigModule,
    LoggerModule,
    RedisModule,
    QueueModule,
    BullBoardModule.forRoot({ route: '/admin/queues', adapter: FastifyAdapter }),
    MailWorkerModule,
  ],
  controllers: [HealthController],
})
export class WorkerModule {}
```

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/worker.module.ts
git commit -m "feat(worker): WorkerModule root (Redis-only, Bull Board)"
```

---

## Task 7: main.worker.ts (bootstrap + auth hook)

**Files:**
- Create: `src/main.worker.ts`

- [ ] **Step 1: Tạo entrypoint worker**

Tạo `src/main.worker.ts`:
```ts
import { createBullBoardAuthHook } from '@common/auth/basic-auth';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { WorkerModule } from './worker.module';

async function bootstrap(): Promise<void> {
  const adapter = new FastifyAdapter();

  // Gắn auth hook vào instance TRƯỚC khi Nest init/ready → áp được cho route do Bull Board
  // (plugin Fastify) đăng ký. Đọc creds qua process.env vì ConfigService chưa có lúc này;
  // production vẫn được CoreConfigModule fail-fast nếu thiếu BULLBOARD_PASSWORD.
  const user = process.env.BULLBOARD_USER ?? 'admin';
  const pass = process.env.BULLBOARD_PASSWORD ?? 'admin';
  adapter.getInstance().addHook('onRequest', createBullBoardAuthHook('/admin/queues', user, pass));

  const app = await NestFactory.create<NestFastifyApplication>(WorkerModule, adapter, {
    bufferLogs: true,
  });
  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  const port = app.get(ConfigService).getOrThrow<number>('WORKER_PORT');
  await app.listen(port, '0.0.0.0');
  app.get(Logger).log(`Worker on :${port} | Bull Board at /admin/queues`, 'WorkerBootstrap');
}

bootstrap().catch((err) => {
  // App có thể chưa tồn tại — fallback console cho lỗi bootstrap.
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Typecheck + build**

Run: `pnpm typecheck && pnpm build`
Expected: PASS; `dist/src/main.worker.js` được sinh ra.
Verify: `ls dist/src/main.worker.js` → tồn tại.

- [ ] **Step 3: Commit**

```bash
git add src/main.worker.ts
git commit -m "feat(worker): entrypoint main.worker.ts + auth hook Bull Board"
```

---

## Task 8: Scripts pnpm

**Files:**
- Modify: `package.json` (scripts)

- [ ] **Step 1: Thêm scripts**

Trong `package.json`, thêm vào block `"scripts"` (cạnh `start:prod`):
```jsonc
"start:worker": "nest start --entryFile main.worker",
"start:worker:dev": "nest start --watch --entryFile main.worker",
"start:worker:prod": "node dist/src/main.worker.js",
"test:e2e": "jest --config jest.e2e.config.js",
```

- [ ] **Step 2: Verify script tồn tại**

Run: `pnpm run | grep -E "start:worker|test:e2e"`
Expected: liệt kê 4 script vừa thêm.

- [ ] **Step 3: Commit**

```bash
git add package.json
git commit -m "chore(worker): scripts start:worker + test:e2e"
```

---

## Task 9: E2E — Bull Board auth qua Fastify hook

**Files:**
- Create: `jest.e2e.config.js`
- Test: `test/e2e/worker-bull-board.e2e-spec.ts`

- [ ] **Step 1: Tạo Jest config e2e**

Tạo `jest.e2e.config.js`:
```js
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  roots: ['<rootDir>/test/e2e'],
  testRegex: '.*\\.e2e-spec\\.ts$',
  transform: { '^.+\\.(t|j)s$': '@swc/jest' },
  moduleNameMapper: {
    '^@common/(.*)$': '<rootDir>/src/common/$1',
    '^@core/(.*)$': '<rootDir>/src/core/$1',
    '^@modules/(.*)$': '<rootDir>/src/modules/$1',
    '^@generated/(.*)$': '<rootDir>/src/generated/$1',
  },
  testEnvironment: 'node',
};
```

- [ ] **Step 2: Viết e2e test**

Tạo `test/e2e/worker-bull-board.e2e-spec.ts`:
```ts
import { createBullBoard } from '@bull-board/api';
import { FastifyAdapter } from '@bull-board/fastify';
import { createBullBoardAuthHook } from '@common/auth/basic-auth';
import Fastify, { type FastifyInstance } from 'fastify';

// Dựng standalone Fastify + plugin Bull Board (queues rỗng, KHÔNG cần Redis) để kiểm chứng
// onRequest hook ở root instance thực sự chặn được route do plugin Bull Board đăng ký.
describe('Bull Board auth (Fastify onRequest hook)', () => {
  const ROUTE = '/admin/queues';
  const USER = 'admin';
  const PASS = 'secret';
  let app: FastifyInstance;

  beforeAll(async () => {
    app = Fastify();
    app.addHook('onRequest', createBullBoardAuthHook(ROUTE, USER, PASS));
    const serverAdapter = new FastifyAdapter();
    serverAdapter.setBasePath(ROUTE);
    createBullBoard({ queues: [], serverAdapter });
    await app.register(serverAdapter.registerPlugin(), { prefix: ROUTE });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('401 khi không có credentials', async () => {
    const res = await app.inject({ method: 'GET', url: ROUTE });
    expect(res.statusCode).toBe(401);
    expect(String(res.headers['www-authenticate'])).toContain('Basic');
  });

  it('vào được (2xx/3xx) khi Basic Auth đúng', async () => {
    const authz = `Basic ${Buffer.from(`${USER}:${PASS}`).toString('base64')}`;
    const res = await app.inject({ method: 'GET', url: ROUTE, headers: { authorization: authz } });
    expect(res.statusCode).toBeLessThan(400);
    expect(res.statusCode).toBeGreaterThanOrEqual(200);
  });
});
```

> `fastify` import trực tiếp được vì là dependency bắc cầu của `@nestjs/platform-fastify` (Fastify 5.8.5). Nếu trình giải phụ thuộc chặt báo thiếu, chạy `pnpm add -D fastify` để khai báo tường minh.

- [ ] **Step 3: Chạy e2e để xác nhận PASS**

Run: `pnpm test:e2e`
Expected: PASS (2 test). Test 1 chứng minh hook chặn (401), test 2 chứng minh route plugin phục vụ được sau khi qua auth.

- [ ] **Step 4: Commit**

```bash
git add jest.e2e.config.js test/e2e/worker-bull-board.e2e-spec.ts
git commit -m "test(worker): e2e Bull Board auth qua Fastify hook (401/200)"
```

---

## Task 10: Verify toàn bộ + smoke thủ công

**Files:** (không sửa code — kiểm thử tích hợp)

- [ ] **Step 1: Chạy toàn bộ unit + verify**

Run: `pnpm test`
Expected: PASS toàn bộ (gồm các spec mới ở Task 1–4).

Run: `pnpm verify`
Expected: `i18n:gen` + `check` + `typecheck` + `build` PASS; `dist/src/main.js` và `dist/src/main.worker.js` đều tồn tại.

- [ ] **Step 2: Chạy e2e**

Run: `pnpm test:e2e`
Expected: PASS (2 test).

- [ ] **Step 3: Smoke thủ công (cần Redis)**

```bash
docker compose up -d redis
# Terminal 1 — API (thuần producer)
pnpm start:dev
# Terminal 2 — Worker
pnpm start:worker:dev
```
Kiểm tra:
- `curl http://localhost:3001/health` → `{"status":"ok",...,"redis":"up"}`.
- `curl -i http://localhost:3001/admin/queues` → `401` + header `WWW-Authenticate`.
- `curl -u admin:admin http://localhost:3001/admin/queues` → `2xx/3xx` (vào Bull Board), thấy queue `mail`.
- Enqueue job:
  ```bash
  curl -X POST http://localhost:3000/mail/test -H 'content-type: application/json' \
    -d '{"to":"a@b.com","subject":"Hi","body":"x"}'
  ```
  → log `Sending mail to a@b.com` xuất hiện ở **Terminal 2 (worker)**, KHÔNG ở Terminal 1 (API). Job hiển thị completed trên Bull Board.

- [ ] **Step 4: Commit (nếu có chỉnh trong lúc verify)**

```bash
git add -A
git commit -m "chore(worker): hoàn tất tách worker BullMQ — verify pass" || echo "không có thay đổi"
```

---

## Ghi chú thực thi

- **Thứ tự bắt buộc:** Task 1 (deps) trước mọi task dùng `@bull-board/*`. Task 2 (helper) trước Task 7 và Task 9. Task 5/6 trước Task 7.
- **Convention dự án:** import vượt module dùng alias (`@common/@core/@modules`); trong cùng module dùng relative (`./jobs/...`). Mock repository/Queue bằng `useValue`. `jest.clearAllMocks()` trong `beforeEach`. Không tạo barrel `index.ts`.
- **Điểm rủi ro đã xử lý:** auth Bull Board dùng Fastify `onRequest` hook gắn trước Nest init (không phụ thuộc Nest middleware chặn được plugin route). E2e Task 9 là bằng chứng cơ chế hoạt động.
