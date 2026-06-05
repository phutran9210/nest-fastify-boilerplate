# Tái cấu trúc feature-first + repository port — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tái cấu trúc `src/` của nest-fastify thành modular-monolith feature-first với repository port, và cập nhật docs cho khớp — KHÔNG đổi behavior/endpoint.

**Architecture:** Tách `common/` (cross-cutting) khỏi `core/` (infra); mỗi feature module có `controllers/ services/ repositories/ dto/` (+ `strategies/`·`jobs/` khi cần); service phụ thuộc `abstract class` repository port, impl Prisma bơm qua `{ provide, useClass }`.

**Tech Stack:** NestJS 11 + Fastify, Prisma 7, nestjs-zod, Jest, Biome, pnpm. Nguồn chân lý: `docs/superpowers/specs/2026-06-05-restructure-architecture-design.md`.

**Refactor discipline:** đây là refactor — các spec hiện có (`users.service.spec.ts`, `auth.service.spec.ts`) là lưới an toàn. **Mỗi task PHẢI kết thúc bằng `pnpm build` + `pnpm test` + `pnpm check` đều xanh, rồi commit.** `tsconfig` loại `**/*.spec.ts` khỏi build → build KHÔNG bắt import hỏng trong spec; phải chạy CẢ `pnpm test`.

---

## File Structure (đích)

```
src/
├── common/{decorators,filters,guards,interceptors}/   # chuyển từ core/
├── core/{config,prisma,queue,messaging,health}/       # giữ nguyên
└── modules/
    ├── users/{users.module.ts, controllers/, services/, repositories/, dto/}
    ├── auth/{auth.module.ts, controllers/, services/, strategies/, dto/}
    ├── mail/{mail.module.ts, controllers/, jobs/, dto/}
    └── notifications/{notifications.module.ts, controllers/}   # đổi tên từ messaging/consumer
```

Thứ tự task giữ build xanh ở mỗi commit: common/ trước (nền), rồi từng module (mỗi module atomic + sửa file ngoài tham chiếu tới nó), cuối cùng docs.

---

### Task 1: Tách `common/` khỏi `core/`

**Files:**
- Move: `src/core/decorators/current-user.decorator.ts` → `src/common/decorators/current-user.decorator.ts`
- Move: `src/core/decorators/public.decorator.ts` → `src/common/decorators/public.decorator.ts`
- Move: `src/core/filters/http-exception.filter.ts` → `src/common/filters/http-exception.filter.ts`
- Move: `src/core/guards/jwt-auth.guard.ts` → `src/common/guards/jwt-auth.guard.ts`
- Move: `src/core/interceptors/logging.interceptor.ts` → `src/common/interceptors/logging.interceptor.ts`
- Modify: `src/app.module.ts`, `src/modules/auth/auth.controller.ts`, `src/modules/auth/jwt.strategy.ts`, `src/modules/mail/mail.controller.ts`, `src/modules/messaging/consumer/notifications.controller.ts`

Lưu ý: `jwt-auth.guard.ts` import `../decorators/public.decorator` — vì cả guards/ lẫn decorators/ cùng chuyển vào `common/`, đường dẫn `../decorators/public.decorator` GIỮ NGUYÊN, KHÔNG sửa. Các file được move khác không có internal cross-import.

- [ ] **Step 1: Di chuyển file bằng git mv**

```bash
cd /home/phuth/Desktop/nest-fastify
mkdir -p src/common/decorators src/common/filters src/common/guards src/common/interceptors
git mv src/core/decorators/current-user.decorator.ts src/common/decorators/current-user.decorator.ts
git mv src/core/decorators/public.decorator.ts       src/common/decorators/public.decorator.ts
git mv src/core/filters/http-exception.filter.ts     src/common/filters/http-exception.filter.ts
git mv src/core/guards/jwt-auth.guard.ts             src/common/guards/jwt-auth.guard.ts
git mv src/core/interceptors/logging.interceptor.ts  src/common/interceptors/logging.interceptor.ts
rmdir src/core/decorators src/core/filters src/core/guards src/core/interceptors 2>/dev/null || true
```

- [ ] **Step 2: Rewire `src/app.module.ts`**

Đổi 3 dòng import:
```ts
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
```
(trước đó là `./core/filters/...`, `./core/guards/...`, `./core/interceptors/...`)

- [ ] **Step 3: Rewire các file module tham chiếu `core/decorators`**

`src/modules/auth/auth.controller.ts`:
```ts
import { type AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
```
`src/modules/auth/jwt.strategy.ts`:
```ts
import type { AuthUser } from '../../common/decorators/current-user.decorator';
```
`src/modules/mail/mail.controller.ts`:
```ts
import { Public } from '../../common/decorators/public.decorator';
```
`src/modules/messaging/consumer/notifications.controller.ts`:
```ts
import { Public } from '../../../common/decorators/public.decorator';
```

- [ ] **Step 4: Verify build + test + lint**

```bash
pnpm build && pnpm test && pnpm check
```
Expected: build không lỗi; tất cả test PASS; Biome sạch. Nếu có lỗi import `core/...` còn sót, grep và sửa:
```bash
grep -rnE "core/(decorators|filters|guards|interceptors)" src && echo "STILL REFERENCING OLD PATH" || echo OK
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(structure): split common/ (cross-cutting) out of core/"
```

---

### Task 2: Module `users` — subfolders + repository port

**Files:**
- Move: `src/modules/users/users.controller.ts` → `src/modules/users/controllers/users.controller.ts`
- Move: `src/modules/users/users.service.ts` → `src/modules/users/services/users.service.ts`
- Move: `src/modules/users/users.service.spec.ts` → `src/modules/users/services/users.service.spec.ts`
- Create: `src/modules/users/repositories/user.repository.ts`
- Create: `src/modules/users/repositories/prisma-user.repository.ts`
- Modify: `src/modules/users/users.module.ts`, `src/modules/auth/auth.service.ts` (import path tới users.service)

- [ ] **Step 1: Di chuyển file**

```bash
cd /home/phuth/Desktop/nest-fastify
mkdir -p src/modules/users/controllers src/modules/users/services src/modules/users/repositories
git mv src/modules/users/users.controller.ts      src/modules/users/controllers/users.controller.ts
git mv src/modules/users/users.service.ts          src/modules/users/services/users.service.ts
git mv src/modules/users/users.service.spec.ts     src/modules/users/services/users.service.spec.ts
```

- [ ] **Step 2: Tạo port `src/modules/users/repositories/user.repository.ts`**

```ts
import type { User } from '../../../generated/prisma/client';

// Re-export shape model qua port → service/test phụ thuộc PORT, không import generated/ trực tiếp.
export type { User };

export type CreateUserData = { email: string; password: string; name?: string | null };
export type UpdateUserData = Partial<CreateUserData>;

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findAll(): Promise<User[]>;
  abstract create(data: CreateUserData): Promise<User>;
  abstract update(id: string, data: UpdateUserData): Promise<User>;
  abstract delete(id: string): Promise<User>;
}
```

- [ ] **Step 3: Tạo impl `src/modules/users/repositories/prisma-user.repository.ts`**

```ts
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { User } from '../../../generated/prisma/client';
import { type CreateUserData, type UpdateUserData, UserRepository } from './user.repository';

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }
  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }
  create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({ data });
  }
  update(id: string, data: UpdateUserData): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
  delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }
}
```

- [ ] **Step 4: Viết lại `src/modules/users/services/users.service.ts` (dùng port, không Prisma)**

```ts
import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateUserData,
  type UpdateUserData,
  type User,
  UserRepository,
} from '../repositories/user.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}

  create(data: CreateUserData): Promise<User> {
    return this.users.create(data);
  }

  findAll(): Promise<User[]> {
    return this.users.findAll();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    await this.findOne(id);
    return this.users.update(id, data);
  }

  async remove(id: string): Promise<User> {
    await this.findOne(id);
    return this.users.delete(id);
  }
}
```

- [ ] **Step 5: Viết lại `src/modules/users/users.module.ts`**

```ts
import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';
import { PrismaUserRepository } from './repositories/prisma-user.repository';
import { UserRepository } from './repositories/user.repository';
import { UsersService } from './services/users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, { provide: UserRepository, useClass: PrismaUserRepository }],
  exports: [UsersService],
})
export class UsersModule {}
```

- [ ] **Step 6: Sửa import trong `src/modules/users/controllers/users.controller.ts`**

Controller đã xuống `controllers/` (sâu thêm 1 cấp) nên CẢ dto lẫn service đều đổi từ `./` sang `../`:
```ts
import { CreateUserDto } from '../dto/create-user.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../services/users.service';
```
(logic controller giữ nguyên — chỉ đổi 4 dòng import này)

- [ ] **Step 7: Viết lại `src/modules/users/services/users.service.spec.ts` (mock port)**

```ts
import { Test } from '@nestjs/testing';
import { UserRepository } from '../repositories/user.repository';
import { UsersService } from './users.service';

describe('UsersService', () => {
  let service: UsersService;
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [UsersService, { provide: UserRepository, useValue: repo }],
    }).compile();
    service = moduleRef.get(UsersService);
  });

  it('findByEmail delegates to the repository', async () => {
    const user = { id: '1', email: 'a@b.com', password: 'hash', name: null };
    repo.findByEmail.mockResolvedValue(user);
    const result = await service.findByEmail('a@b.com');
    expect(repo.findByEmail).toHaveBeenCalledWith('a@b.com');
    expect(result).toBe(user);
  });

  it('create passes data to the repository', async () => {
    const created = { id: '1', email: 'a@b.com', password: 'hash', name: 'A' };
    repo.create.mockResolvedValue(created);
    const result = await service.create({ email: 'a@b.com', password: 'hash', name: 'A' });
    expect(repo.create).toHaveBeenCalledWith({ email: 'a@b.com', password: 'hash', name: 'A' });
    expect(result).toBe(created);
  });

  it('findOne throws NotFoundException when the user does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });
});
```

- [ ] **Step 8: Sửa import users.service trong `src/modules/auth/auth.service.ts`**

(auth.service vẫn ở vị trí cũ tại task này — chỉ path tới users.service đổi vì users.service xuống `services/`)
```ts
import { UsersService } from '../users/services/users.service';
```

- [ ] **Step 9: Verify build + test + lint**

```bash
pnpm build && pnpm test && pnpm check
```
Expected: PASS toàn bộ. Kiểm tra service không còn chạm Prisma & không import generated/:
```bash
grep -nE "prisma|generated/prisma" src/modules/users/services/users.service.ts && echo "LEAK!" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(users): feature-first layout + repository port (PrismaUserRepository)"
```

---

### Task 3: Module `auth` — subfolders

**Files:**
- Move: `src/modules/auth/auth.controller.ts` → `src/modules/auth/controllers/auth.controller.ts`
- Move: `src/modules/auth/auth.service.ts` → `src/modules/auth/services/auth.service.ts`
- Move: `src/modules/auth/auth.service.spec.ts` → `src/modules/auth/services/auth.service.spec.ts`
- Move: `src/modules/auth/jwt.strategy.ts` → `src/modules/auth/strategies/jwt.strategy.ts`
- Modify: `src/modules/auth/auth.module.ts` và import trong các file vừa move

- [ ] **Step 1: Di chuyển file**

```bash
cd /home/phuth/Desktop/nest-fastify
mkdir -p src/modules/auth/controllers src/modules/auth/services src/modules/auth/strategies
git mv src/modules/auth/auth.controller.ts   src/modules/auth/controllers/auth.controller.ts
git mv src/modules/auth/auth.service.ts        src/modules/auth/services/auth.service.ts
git mv src/modules/auth/auth.service.spec.ts   src/modules/auth/services/auth.service.spec.ts
git mv src/modules/auth/jwt.strategy.ts        src/modules/auth/strategies/jwt.strategy.ts
```

- [ ] **Step 2: Rewire `src/modules/auth/auth.module.ts`**

```ts
import { AuthController } from './controllers/auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
```
(các import khác — `UsersModule`, `@nestjs/*` — giữ nguyên)

- [ ] **Step 3: Rewire `src/modules/auth/controllers/auth.controller.ts`**

File đã xuống `controllers/` (sâu thêm 1 cấp). Đổi:
```ts
import { type AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { AuthService } from '../services/auth.service';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
```

- [ ] **Step 4: Rewire `src/modules/auth/services/auth.service.ts`**

```ts
import { UsersService } from '../../users/services/users.service';
import type { LoginDto } from '../dto/login.dto';
import type { RegisterDto } from '../dto/register.dto';
```

- [ ] **Step 5: Rewire `src/modules/auth/strategies/jwt.strategy.ts`**

```ts
import type { AuthUser } from '../../../common/decorators/current-user.decorator';
```

- [ ] **Step 6: Rewire `src/modules/auth/services/auth.service.spec.ts`**

```ts
import { UsersService } from '../../users/services/users.service';
import { AuthService } from './auth.service';
```
(các import `@nestjs/common`, `@nestjs/jwt`, `@nestjs/testing`, `bcrypt` giữ nguyên)

- [ ] **Step 7: Verify build + test + lint**

```bash
pnpm build && pnpm test && pnpm check
```
Expected: PASS. `grep -rn "from '\.\./auth\." src/modules/auth` không còn path cũ.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "refactor(auth): feature-first layout (controllers/services/strategies)"
```

---

### Task 4: Module `mail` — subfolders + tách DTO

**Files:**
- Move: `src/modules/mail/mail.controller.ts` → `src/modules/mail/controllers/mail.controller.ts`
- Move: `src/modules/mail/mail.producer.ts` → `src/modules/mail/jobs/mail.producer.ts`
- Move: `src/modules/mail/mail.processor.ts` → `src/modules/mail/jobs/mail.processor.ts`
- Create: `src/modules/mail/dto/send-mail.dto.ts`
- Modify: `src/modules/mail/mail.module.ts` và import các file vừa move

- [ ] **Step 1: Di chuyển file**

```bash
cd /home/phuth/Desktop/nest-fastify
mkdir -p src/modules/mail/controllers src/modules/mail/jobs src/modules/mail/dto
git mv src/modules/mail/mail.controller.ts src/modules/mail/controllers/mail.controller.ts
git mv src/modules/mail/mail.producer.ts    src/modules/mail/jobs/mail.producer.ts
git mv src/modules/mail/mail.processor.ts   src/modules/mail/jobs/mail.processor.ts
```

- [ ] **Step 2: Tạo `src/modules/mail/dto/send-mail.dto.ts` (tách DTO inline ra)**

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const sendMailSchema = z.object({
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
});

export class SendMailDto extends (createZodDto(sendMailSchema) as ReturnType<
  typeof createZodDto<typeof sendMailSchema>
>) {}
```

- [ ] **Step 3: Viết lại `src/modules/mail/controllers/mail.controller.ts`**

```ts
import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../../common/decorators/public.decorator';
import { SendMailDto } from '../dto/send-mail.dto';
import { MailProducer } from '../jobs/mail.producer';

@ApiTags('mail')
@Controller('mail')
export class MailController {
  constructor(private readonly producer: MailProducer) {}

  // @Public so the demo can be triggered without a token. Guard this (remove @Public)
  // before exposing a real queue trigger.
  @Public()
  @Post('test')
  async test(@Body() dto: SendMailDto) {
    const jobId = await this.producer.enqueue(dto);
    return { enqueued: true, jobId };
  }
}
```

- [ ] **Step 4: Sửa import type trong `src/modules/mail/jobs/mail.processor.ts`**

`SendMailJob` vẫn ở `mail.producer.ts` (cùng folder `jobs/`) → import giữ nguyên `./mail.producer`:
```ts
import type { SendMailJob } from './mail.producer';
```
(file này không cần đổi gì — xác nhận lại đường dẫn vẫn đúng sau khi cả hai cùng vào `jobs/`)

- [ ] **Step 5: Rewire `src/modules/mail/mail.module.ts`**

```ts
import { MailController } from './controllers/mail.controller';
import { MailProcessor } from './jobs/mail.processor';
import { MailProducer } from './jobs/mail.producer';
```
(`BullModule`, `Module` giữ nguyên)

- [ ] **Step 6: Verify build + test + lint**

```bash
pnpm build && pnpm test && pnpm check
```
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(mail): feature-first layout + extract SendMailDto"
```

---

### Task 5: `messaging/consumer` → `modules/notifications`

**Files:**
- Move: `src/modules/messaging/consumer/notifications.controller.ts` → `src/modules/notifications/controllers/notifications.controller.ts`
- Move: `src/modules/messaging/consumer/notifications.module.ts` → `src/modules/notifications/notifications.module.ts`
- Delete: thư mục rỗng `src/modules/messaging/`
- Modify: import trong 2 file vừa move + `src/app.module.ts`

- [ ] **Step 1: Di chuyển file & xóa thư mục cũ**

```bash
cd /home/phuth/Desktop/nest-fastify
mkdir -p src/modules/notifications/controllers
git mv src/modules/messaging/consumer/notifications.controller.ts src/modules/notifications/controllers/notifications.controller.ts
git mv src/modules/messaging/consumer/notifications.module.ts       src/modules/notifications/notifications.module.ts
rmdir src/modules/messaging/consumer src/modules/messaging 2>/dev/null || true
```

- [ ] **Step 2: Rewire `src/modules/notifications/controllers/notifications.controller.ts`**

Độ sâu giờ là `modules/notifications/controllers/` (3 cấp tới `src`):
```ts
import { Public } from '../../../common/decorators/public.decorator';
import { RMQ_CLIENT } from '../../../core/messaging/messaging.module';
```
(logic, `@EventPattern`, `@Controller('notifications')` giữ nguyên)

- [ ] **Step 3: Rewire `src/modules/notifications/notifications.module.ts`**

```ts
import { NotificationsController } from './controllers/notifications.controller';
```

- [ ] **Step 4: Rewire `src/app.module.ts`**

```ts
import { NotificationsModule } from './modules/notifications/notifications.module';
```
(tên class `NotificationsModule` và vị trí trong mảng `imports` giữ nguyên)

- [ ] **Step 5: Verify build + test + lint**

```bash
pnpm build && pnpm test && pnpm check
grep -rn "modules/messaging" src && echo "STILL REFERENCING messaging" || echo OK
```
Expected: build/test/check PASS; grep in `OK`.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "refactor(notifications): rename modules/messaging/consumer -> modules/notifications"
```

---

### Task 6: Cập nhật docs (commands + CLAUDE.md + README)

**Files:**
- Modify: `.claude/commands/coding-convention.md`, `.claude/commands/create-module.md`, `.claude/commands/create-test.md`, `.claude/commands/review-code.md`, `.claude/commands/create-dto.md`
- Modify: `CLAUDE.md`, `README.md`

- [ ] **Step 1: `coding-convention.md`** — đổi mục cấu trúc: bỏ "flat structure / no subfolders"; mô tả layout module mới (`controllers/ services/ repositories/ dto/` + `strategies/`·`jobs/`); thêm `common/` (cross-cutting) vs `core/` (infra). Đổi mục Prisma: "service inject PrismaService" → "service phụ thuộc repository PORT (`abstract class`); CHỈ `prisma-<feature>.repository.ts` import `PrismaService` + `generated/`; port re-export model type". Giữ nguyên các quy ước khác.

- [ ] **Step 2: `create-module.md`** — cập nhật cây file sinh ra (subfolders + `repositories/{<f>.repository.ts (port), prisma-<f>.repository.ts (impl)}`); thêm bước sinh wiring `{ provide: <F>Repository, useClass: Prisma<F>Repository }`; **GIỮ precondition kiểm tra model trong `prisma/schema.prisma`** (impl gọi `this.prisma.<f>` không compile nếu thiếu model → chỉ sinh code Prisma khi model có, nếu chưa thì dừng + hướng dẫn `pnpm prisma:migrate && pnpm prisma:generate`). Dùng template port/impl/service/module y như Task 2 của plan này.

- [ ] **Step 3: `create-test.md`** — đổi ví dụ: mock **repository port** (`const repo = { findById: jest.fn(), ... }` + `{ provide: <F>Repository, useValue: repo }`) thay cho mock `PrismaService`; spec đặt cạnh source trong `services/`.

- [ ] **Step 4: `review-code.md`** — thêm/sửa tiêu chí kiến trúc: service KHÔNG gọi `this.prisma.*` trực tiếp và KHÔNG import `generated/prisma` (chỉ `prisma-*.repository.ts` được); kiểm tra wiring port↔impl tồn tại; `common/` vs `core/` đúng chỗ.

- [ ] **Step 5: `create-dto.md`** — rà lại: path DTO vẫn `modules/<feature>/dto/` (không đổi); chỉ sửa nếu có câu mô tả cấu trúc module cũ.

- [ ] **Step 6: `CLAUDE.md`** — cập nhật mục cấu trúc (common/ vs core/, layout module, `modules/notifications`) + tầng dữ liệu (repository port; service không chạm Prisma; test mock repo).

- [ ] **Step 7: `README.md`** — cập nhật cây "Project structure" (lines ~48-66): `core/` chỉ còn `config/ prisma/ queue/ messaging/ health/`; thêm `common/` (decorators/ filters/ guards/ interceptors/); module hiển thị subfolder + `repositories/`; đổi `messaging/consumer/` → `notifications/`. Cập nhật phần mô tả nếu nhắc layout cũ.

- [ ] **Step 8: Verify không còn mô tả layout cũ trong docs**

```bash
cd /home/phuth/Desktop/nest-fastify
grep -rniE "flat structure|cấu trúc phẳng|inject PrismaService|core/(guards|filters|decorators|interceptors)|messaging/consumer" .claude/commands/ CLAUDE.md README.md
```
Expected: chỉ còn match trong câu phủ định/lịch sử (kiểm tra ngữ cảnh) — không còn mô tả layout cũ như hiện hành. Sửa tới khi sạch.
Không chèn ký tự Unicode ẩn:
```bash
grep -rcP "[\x{200B}\x{200C}\x{200D}\x{FEFF}\x{2060}]" .claude/commands/ CLAUDE.md README.md | grep -v ':0$' || echo "no invisible chars"
```

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "docs: update commands + CLAUDE.md + README for feature-first + repository port"
```

---

### Task 7: Smoke verification cuối

- [ ] **Step 1: Build + test + lint sạch toàn bộ**

```bash
cd /home/phuth/Desktop/nest-fastify
pnpm build && pnpm test && pnpm check
```
Expected: tất cả PASS.

- [ ] **Step 2: Không còn tham chiếu đường dẫn cũ trong `src`**

```bash
grep -rnE "core/(guards|filters|decorators|interceptors)|modules/messaging" src && echo "FOUND OLD PATH" || echo "clean"
```
Expected: `clean`.

- [ ] **Step 3: Service không leak Prisma (chỉ repo impl chạm)**

```bash
grep -rln "PrismaService\|generated/prisma" src/modules/*/services && echo "SERVICE LEAKS PRISMA" || echo "clean"
```
Expected: `clean` (chỉ `repositories/prisma-*.repository.ts` được phép).

- [ ] **Step 4: (Tùy chọn) Boot thử nếu hạ tầng sẵn sàng**

Nếu có Postgres/Redis/RabbitMQ local: `pnpm start:dev` boot được, mở `/docs`. Nếu không có hạ tầng, bỏ qua — build+test đã đủ cho refactor này.

- [ ] **Step 5: Commit (nếu có fixup; nếu sạch thì bỏ qua)**

```bash
git add -A && git commit -m "chore: restructure smoke-check fixups" || echo "nothing to commit"
```

---

## Notes
- Đang ở branch `feat/nestjs-fastify-boilerplate`; không tạo branch mới.
- Refactor thuần — KHÔNG đổi endpoint, schema, hay behavior.
- Mỗi task atomic + build/test/check xanh trước khi commit. Nếu một task fail verify, sửa rồi mới sang task sau.
