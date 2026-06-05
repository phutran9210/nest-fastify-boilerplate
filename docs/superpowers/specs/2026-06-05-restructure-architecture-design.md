# Design: Tái cấu trúc feature-first + repository port

**Ngày:** 2026-06-05
**Trạng thái:** Đã chốt design, chờ review spec

## 1. Mục tiêu

Tái cấu trúc `src/` của `nest-fastify` theo **modular monolith feature-first** với **repository port
interface** cho tầng dữ liệu, để code sạch hơn và dễ mở rộng kiến trúc về sau. Áp cho **tất cả** module
hiện có và **cập nhật toàn bộ** slash commands + `CLAUDE.md` + `README.md` cho khớp.

Quyết định nền tảng (đã chốt với người dùng):
- Cấu trúc: feature-first modular monolith (KHÔNG hexagonal đầy đủ — không tách domain/application layer).
- Tầng dữ liệu: **repository + port interface** (abstract class vừa là type vừa là DI token; impl Prisma
  bơm qua `{ provide, useClass }`).
- Phạm vi: migrate tất cả module (users, auth, mail, messaging/consumer).
- Docs: cập nhật hết commands + CLAUDE.md.
- Giữ **relative imports** (không path alias — tránh rủi ro runtime với `nest build`/`start:prod`).

## 2. Cấu trúc đích

```
src/
├── main.ts
├── app.module.ts
├── common/                         # cross-cutting framework-level, KHÔNG business logic
│   ├── decorators/
│   │   ├── current-user.decorator.ts
│   │   └── public.decorator.ts
│   ├── filters/http-exception.filter.ts
│   ├── guards/jwt-auth.guard.ts
│   └── interceptors/logging.interceptor.ts
├── core/                           # hạ tầng & wiring (kết nối ra ngoài)
│   ├── config/{config.module.ts, env.schema.ts}
│   ├── prisma/{prisma.module.ts, prisma.service.ts}
│   ├── queue/queue.module.ts
│   ├── messaging/messaging.module.ts
│   └── health/health.controller.ts
├── generated/prisma/               # KHÔNG đổi
└── modules/
    ├── users/
    │   ├── users.module.ts
    │   ├── controllers/users.controller.ts
    │   ├── services/users.service.ts
    │   ├── services/users.service.spec.ts
    │   ├── repositories/user.repository.ts          # PORT
    │   ├── repositories/prisma-user.repository.ts   # IMPL
    │   └── dto/{create-user,update-user,user-response}.dto.ts
    ├── auth/
    │   ├── auth.module.ts
    │   ├── controllers/auth.controller.ts
    │   ├── services/auth.service.ts
    │   ├── services/auth.service.spec.ts
    │   ├── strategies/jwt.strategy.ts
    │   └── dto/{login,register}.dto.ts
    ├── mail/
    │   ├── mail.module.ts
    │   ├── controllers/mail.controller.ts
    │   ├── jobs/mail.producer.ts
    │   ├── jobs/mail.processor.ts
    │   └── dto/send-mail.dto.ts
    └── notifications/              # đổi tên từ messaging/consumer
        ├── notifications.module.ts
        └── controllers/notifications.controller.ts
```

## 3. Di chuyển file (git mv) — chi tiết

### 3.1 core/ → common/ (cross-cutting)
- `src/core/decorators/current-user.decorator.ts` → `src/common/decorators/current-user.decorator.ts`
- `src/core/decorators/public.decorator.ts` → `src/common/decorators/public.decorator.ts`
- `src/core/filters/http-exception.filter.ts` → `src/common/filters/http-exception.filter.ts`
- `src/core/guards/jwt-auth.guard.ts` → `src/common/guards/jwt-auth.guard.ts`
- `src/core/interceptors/logging.interceptor.ts` → `src/common/interceptors/logging.interceptor.ts`

`src/core/{config,prisma,queue,messaging,health}` **giữ nguyên**.

### 3.2 modules/users
- `users.controller.ts` → `controllers/users.controller.ts`
- `users.service.ts` → `services/users.service.ts` (bỏ import PrismaService; inject `UserRepository`)
- `users.service.spec.ts` → `services/users.service.spec.ts` (mock `UserRepository`)
- MỚI `repositories/user.repository.ts`, `repositories/prisma-user.repository.ts`
- `dto/*` giữ nguyên vị trí (đã ở `dto/`)
- `users.module.ts` cập nhật providers

### 3.3 modules/auth
- `auth.controller.ts` → `controllers/auth.controller.ts`
- `auth.service.ts` → `services/auth.service.ts`
- `auth.service.spec.ts` → `services/auth.service.spec.ts`
- `jwt.strategy.ts` → `strategies/jwt.strategy.ts`
- `dto/*` giữ nguyên

### 3.4 modules/mail
- `mail.controller.ts` → `controllers/mail.controller.ts` (tách `SendMailDto` inline ra `dto/send-mail.dto.ts`)
- `mail.producer.ts` → `jobs/mail.producer.ts` (giữ interface `SendMailJob` ở đây)
- `mail.processor.ts` → `jobs/mail.processor.ts`
- MỚI `dto/send-mail.dto.ts`

### 3.5 modules/messaging/consumer → modules/notifications
- `notifications.controller.ts` → `modules/notifications/controllers/notifications.controller.ts`
- `notifications.module.ts` → `modules/notifications/notifications.module.ts`
- Xóa thư mục rỗng `src/modules/messaging/`

## 4. Repository port pattern

```ts
// modules/users/repositories/user.repository.ts  — PORT
import type { User } from '../../../generated/prisma/client';

// Re-export shape model qua port → service/test phụ thuộc PORT, KHÔNG import generated/ trực tiếp.
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

```ts
// modules/users/repositories/prisma-user.repository.ts  — IMPL (chỗ DUY NHẤT chạm Prisma)
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

```ts
// modules/users/services/users.service.ts  — không còn this.prisma, không import generated/
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

```ts
// modules/users/users.module.ts
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

```ts
// modules/users/services/users.service.spec.ts  — mock PORT thay vì PrismaService
const repo = {
  findById: jest.fn(),
  findByEmail: jest.fn(),
  findAll: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
};
// providers: [UsersService, { provide: UserRepository, useValue: repo }]
// findOne miss: repo.findById.mockResolvedValue(null) → rejects.toMatchObject({ status: 404 })
```

**Ghi chú thiết kế:**
- Định nghĩa "chạm Prisma" = **runtime**: chỉ `prisma-*.repository.ts` được import/dùng `PrismaService`
  và gọi query. Import **type-only** model (`User`) là chấp nhận được, nhưng để boundary sạch, port
  **re-export** `User` (`export type { User }`) → service và test import `User` từ port, KHÔNG import
  `generated/prisma/client` trực tiếp. (Chỉ `prisma-*.repository.ts` import generated/.)
- Port trả `User` (shape hàng dữ liệu). Input dùng type module-local (`CreateUserData`/`UpdateUserData`)
  để KHÔNG leak `Prisma.UserCreateInput`. Tách hẳn domain entity + mapper là follow-up (YAGNI).

## 5. Import rewiring (relative paths sau khi di chuyển)

Chỉ là đổi đường dẫn — KHÔNG đổi logic. Các điểm cần sửa:

- `app.module.ts`:
  - `./core/filters/http-exception.filter` → `./common/filters/http-exception.filter`
  - `./core/guards/jwt-auth.guard` → `./common/guards/jwt-auth.guard`
  - `./core/interceptors/logging.interceptor` → `./common/interceptors/logging.interceptor`
  - `./modules/messaging/consumer/notifications.module` → `./modules/notifications/notifications.module`
- `common/guards/jwt-auth.guard.ts`: import `public.decorator` → `../decorators/public.decorator`
- `modules/auth/controllers/auth.controller.ts`:
  - decorators → `../../../common/decorators/{current-user,public}.decorator`
  - users response dto → `../../users/dto/user-response.dto`
  - service → `../services/auth.service`; dto → `../dto/{login,register}.dto`
- `modules/auth/auth.module.ts`: controller → `./controllers/auth.controller`;
  service → `./services/auth.service`; strategy → `./strategies/jwt.strategy`
- `modules/auth/services/auth.service.ts`: users service → `../../users/services/users.service`;
  dto → `../dto/{login,register}.dto`
- `modules/auth/strategies/jwt.strategy.ts`: decorator → `../../../common/decorators/current-user.decorator`
- `modules/mail/controllers/mail.controller.ts`: public → `../../../common/decorators/public.decorator`;
  producer → `../jobs/mail.producer`; dto → `../dto/send-mail.dto`
- `modules/mail/jobs/mail.processor.ts`: type `SendMailJob` → `./mail.producer`
- `modules/mail/mail.module.ts`: controller → `./controllers/mail.controller`;
  producer/processor → `./jobs/mail.{producer,processor}`
- `modules/notifications/controllers/notifications.controller.ts`:
  public → `../../../common/decorators/public.decorator`; `RMQ_CLIENT` → `../../../core/messaging/messaging.module`
- `modules/notifications/notifications.module.ts`: controller → `./controllers/notifications.controller`
- `modules/users/controllers/users.controller.ts`: service → `../services/users.service`; dto → `../dto/*`

**Spec files (BẮT BUỘC sửa — tsconfig loại `**/*.spec.ts` khỏi build nên `pnpm build` KHÔNG bắt được
import hỏng ở spec; chỉ `pnpm test` mới bắt):**
- `modules/users/services/users.service.spec.ts`: PrismaService import bị BỎ (giờ mock `UserRepository`
  từ `../repositories/user.repository`); xem mục 4.
- `modules/auth/services/auth.service.spec.ts`: users service → `../../users/services/users.service`;
  auth service → `../services/auth.service` (cùng folder vẫn là `./auth.service`); `UnauthorizedException`,
  `JwtService`, `bcrypt` giữ nguyên.

**Nguyên tắc:** sau mỗi lần di chuyển, sửa import của file vừa chuyển VÀ mọi file import tới nó. Chạy CẢ
`pnpm build` (bắt import/type sai ở source) VÀ `pnpm test` (bắt import sai ở spec) — cả hai phải sạch.

## 6. Cập nhật docs (commands + CLAUDE.md)

Tất cả file `.claude/commands/*.md` + `CLAUDE.md` hiện mô tả cấu trúc PHẲNG cũ — phải sửa:

- **coding-convention.md**: "flat structure, no subfolders" → cấu trúc module mới (controllers/services/
  repositories/dto + strategies/jobs khi cần); `common/` vs `core/`; "service inject PrismaService" →
  "service phụ thuộc repository PORT; chỉ `prisma-*.repository.ts` chạm Prisma".
- **create-module.md**: cây file mới; sinh thêm `repositories/<feature>.repository.ts` (port) +
  `prisma-<feature>.repository.ts` (impl) + wiring `{ provide: XRepository, useClass: PrismaXRepository }`;
  controller/service/dto vào subfolder. **GIỮ NGUYÊN precondition kiểm tra model trong
  `prisma/schema.prisma`** (mục này càng quan trọng hơn: `prisma-<feature>.repository.ts` gọi
  `this.prisma.<feature>` sẽ không compile nếu model/client chưa tồn tại) — chỉ sinh code Prisma khi model
  đã có; nếu chưa, dừng và hướng dẫn `pnpm prisma:migrate && pnpm prisma:generate` như hiện tại.
- **create-dto.md**: path vẫn `modules/<feature>/dto/` (không đổi nhiều) — kiểm tra lại lời văn.
- **create-test.md**: mock **repository port** (plain object `useValue`) thay vì mock PrismaService; spec
  nằm cạnh source trong `services/`.
- **review-code.md**: thêm/sửa tiêu chí — service KHÔNG gọi `this.prisma.*` trực tiếp (chỉ repo impl được);
  kiểm tra wiring port↔impl.
- **CLAUDE.md**: mục cấu trúc + tầng dữ liệu (repository port); `common/` vs `core/`; test mock repo.
- **README.md**: cây cấu trúc trong README hiện mô tả layout cũ (`core/guards|filters|decorators`,
  `modules/messaging/consumer/`) — cập nhật cây + mô tả cho khớp `common/` vs `core/`, layout module mới,
  `modules/notifications/`, và repository port.

Giữ nguyên các quy ước khác (any được phép, auth opt-out, date caveat, Temporal, nestjs-zod, Biome, pnpm).

## 7. Verify

**Jest discovery:** `jest.config.js` dùng `rootDir: 'src'` + `testRegex: '.*\.spec\.ts$'` → tự tìm spec
ở mọi subfolder (kể cả `services/`). Di chuyển spec vào `services/` KHÔNG cần đổi config.

- `pnpm build` → tsc compile sạch, KHÔNG lỗi import/type.
- `pnpm test` → tất cả spec xanh (users + auth specs đã chỉnh theo layout/port mới).
- `pnpm check` → Biome format + lint sạch.
- (Tùy chọn) `pnpm start:dev` boot được, Swagger `/docs` load — xác nhận DI token port hoạt động.

## 8. Ngoài phạm vi (YAGNI)
- KHÔNG tách domain entity + mapper (port trả Prisma model type là đủ cho giờ).
- KHÔNG thêm path alias (`@common/*`…) — để follow-up nếu relative path quá sâu.
- KHÔNG thêm repository cho module không có DB (auth dùng UsersService; mail/notifications không có DB).
- KHÔNG đổi schema Prisma, không đổi behavior/endpoint.

## 9. Tiêu chí hoàn thành
- Cấu trúc đích (mục 2) đạt được; không còn file lạc chỗ ở `core/decorators|filters|guards|interceptors`
  hay `modules/messaging/`.
- `users` chạy qua repository port; service không import PrismaService.
- `pnpm build`, `pnpm test`, `pnpm check` đều pass.
- Docs (commands + CLAUDE.md + README.md) khớp cấu trúc mới, không còn mô tả "flat" hay layout cũ.
- Commit sạch trên branch hiện tại.
