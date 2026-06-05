# /create-test — Tạo Jest unit test cho service hoặc controller

Đọc file nguồn tại `$ARGUMENTS`, rồi tạo file spec colocated kế bên nó.

## Quy tắc đặt file

File test phải nằm **cùng thư mục** với file nguồn. Ví dụ:

- Nguồn: `src/modules/users/services/users.service.ts`
- Test:   `src/modules/users/services/users.service.spec.ts`

KHÔNG đặt test trong `__tests__/`. Không tạo thư mục riêng.

## Cấu trúc module test

Dùng `Test.createTestingModule` với tất cả dependency được mock bằng **plain object** thông qua `useValue`. KHÔNG dùng `jest.mock(...)` trực tiếp để mock module, KHÔNG dùng `createMock<...>()`, KHÔNG dùng `getRepositoryToken`, KHÔNG dùng `@InjectRepository` (đây là pattern của TypeORM, không phải dự án này).

### Ví dụ đầy đủ — service dùng repository port

```ts
import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { ProductRepository } from '../repositories/product.repository';
import { ProductsService } from './products.service';

describe('ProductsService', () => {
  let service: ProductsService;
  const repo = {
    findById: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        ProductsService,
        { provide: ProductRepository, useValue: repo },
      ],
    }).compile();
    service = moduleRef.get(ProductsService);
  });

  it('findOne throws NotFoundException when the product does not exist', async () => {
    repo.findById.mockResolvedValue(null);
    await expect(service.findOne('missing')).rejects.toMatchObject({ status: 404 });
    expect(repo.findById).toHaveBeenCalledWith('missing');
  });

  it('create delegates to repository.create and returns the new product', async () => {
    const created = { id: '1', name: 'A', price: 10 };
    repo.create.mockResolvedValue(created);
    const result = await service.create({ name: 'A', price: 10 });
    expect(repo.create).toHaveBeenCalledWith({ name: 'A', price: 10 });
    expect(result).toBe(created);
  });
});
```

> Mock là **repository PORT** (`ProductRepository`), không phải `PrismaService`. Service không biết gì về Prisma.

### Mock dependency service (không phải repository)

Nếu service cần inject một service khác (ví dụ `UsersService`), tạo plain object tương tự:

```ts
const users = { findByEmail: jest.fn(), create: jest.fn() };
// Rồi truyền vào providers:
{ provide: UsersService, useValue: users }
```

## Quy tắc viết test

- `beforeEach` luôn gọi `jest.clearAllMocks()` trước khi compile module.
- Tên test mô tả **hành vi** bằng ngôn ngữ tự nhiên, ví dụ:
  - `'findOne throws NotFoundException when the user does not exist'`
  - `'create delegates to repository.create and returns the new user'`
  - KHÔNG bắt buộc template cứng `should … when …`.
  - KHÔNG thêm comment `// Arrange / // Act / // Assert`.
- Assertion phải **cụ thể**:
  - `toHaveBeenCalledWith(...)` — kiểm tra đúng tham số
  - `toBe(...)` / `toEqual(...)` — kiểm tra giá trị trả về
  - `rejects.toBeInstanceOf(NotFoundException)` hoặc `rejects.toMatchObject({ status: 404 })` — kiểm tra exception

## Các bước thực hiện

1. Đọc file tại `$ARGUMENTS` để hiểu class, constructor dependencies, và các method public.
2. Xác định tên file spec: thay `.ts` thành `.spec.ts`, giữ nguyên đường dẫn thư mục.
3. Tạo mock object cho từng dependency:
   - Nếu service inject repository PORT (abstract class) → mock PORT đó bằng plain object.
   - Nếu service inject một service khác → mock service đó bằng plain object.
4. Viết ít nhất một test case cho mỗi method public của class:
   - Happy path (trả về đúng dữ liệu).
   - Error/edge case nếu method có xử lý lỗi (ví dụ: not found, validation fail).
5. Chỉ import những gì thực sự dùng.
6. Không tạo file nào khác ngoài file spec.

## Chạy test

```bash
# Chạy toàn bộ
pnpm test

# Chạy riêng file vừa tạo
pnpm test src/modules/users/services/users.service.spec.ts
```
