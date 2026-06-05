# Design: Chuẩn hóa error + response trả về client

**Ngày:** 2026-06-05
**Trạng thái:** Đã chốt design, chờ review spec

---

## 1. Mục tiêu

Thống nhất **một contract duy nhất** cho mọi response HTTP trả về client:

- **Success**: bọc trong envelope `{ success, data, meta }`.
- **Error**: envelope đối xứng `{ success, error, meta }` với `error.code` đọc được bằng máy.
- **Errors toàn dự án**: vẫn ném bằng Nest exceptions như hiện tại; một filter trung tâm map `status → code` và chuẩn hóa payload.

Không thay đổi cách service/repository ném lỗi (tránh refactor diện rộng). Repository vẫn map Prisma errors → Nest exceptions như hiện hành.

---

## 2. Quyết định đã chốt (từ brainstorming)

| Vấn đề | Quyết định |
|---|---|
| Hình dạng success | Full envelope `{ success: true, data, meta }` |
| Hình dạng error | Envelope đối xứng `{ success: false, error: { code, message, details? }, meta }` |
| Cách ném lỗi | Giữ Nest exceptions; filter derive `code` từ HTTP status |
| Pagination meta | Đầy đủ: `page, limit, total, totalPages, hasNext, hasPrev` (cần `repo.count()`) |
| requestId | Honor header `x-request-id` ↔ Fastify `req.id`, echo lại trên response |
| Kiến trúc interceptor | **Approach A** — hai interceptor phối hợp, có thứ tự |

---

## 3. Kiến trúc — Approach A (hai interceptor phối hợp)

`ZodSerializerInterceptor` (global, hiện có) tiếp tục serialize giá trị trả về của handler theo `@ZodSerializerDto`. Thêm `ResponseInterceptor` đăng ký **TRƯỚC** `ZodSerializerInterceptor`.

NestJS interceptor là mô hình onion: response chạy **ngược** thứ tự đăng ký. Thứ tự đăng ký dự kiến:

```
[ LoggingInterceptor, ResponseInterceptor, ZodSerializerInterceptor ]
```

→ Trên đường response: **ZodSerializer chạy trước** (serialize data theo DTO, transform Date → ISO),
sau đó **ResponseInterceptor** bọc kết quả đã-serialize vào envelope, cuối cùng Logging.

Nhờ vậy `ResponseInterceptor` chỉ nhìn thấy dữ liệu đã được Zod serialize, không xung đột.

### Phát hiện pagination (shape-based)

List endpoint trả về object từ factory `paginatedDto(ItemDto)` → `{ items, page, limit, total }`.
Sau khi Zod serialize, `ResponseInterceptor` nhận diện bằng shape:

```ts
isPaginated = payload && typeof payload === 'object'
  && 'items' in payload && 'total' in payload && 'page' in payload && 'limit' in payload;
```

Khi paginated: `data = payload.items`; `meta.pagination` được tính từ `page/limit/total`.
Ngược lại: `data = payload`.

> Trade-off đã chấp nhận: nhận diện theo shape thay vì `instanceof`. Vì toàn bộ DTO do ta kiểm soát,
> rủi ro trùng shape là không đáng kể.

---

## 4. Wire contract

### 4.1 Success — single resource

```jsonc
{
  "success": true,
  "data": { "id": "…", "email": "…", "name": null, "createdAt": "…", "updatedAt": "…" },
  "meta": {
    "timestamp": "2026-06-05T10:00:00.000Z",
    "path": "/users/123",
    "requestId": "req-1"
  }
}
```

### 4.2 Success — paginated list

```jsonc
{
  "success": true,
  "data": [ /* … items đã serialize … */ ],
  "meta": {
    "timestamp": "2026-06-05T10:00:00.000Z",
    "path": "/users",
    "requestId": "req-1",
    "pagination": {
      "page": 1,
      "limit": 20,
      "total": 57,
      "totalPages": 3,
      "hasNext": true,
      "hasPrev": false
    }
  }
}
```

### 4.3 Error

```jsonc
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      { "field": "email", "message": "Invalid email" }
    ]
  },
  "meta": {
    "timestamp": "2026-06-05T10:00:00.000Z",
    "path": "/users",
    "requestId": "req-1"
  }
}
```

`error.details` là optional — chỉ xuất hiện cho lỗi validation (và các lỗi có structured detail).

---

## 5. Components

Tất cả nằm dưới `src/common/`.

| File | Vai trò |
|---|---|
| `http/response.types.ts` | TS types: `SuccessResponse<T>`, `ErrorResponse`, `ResponseMeta`, `PaginationMeta`, `ErrorDetail`. Đây là contract. |
| `http/paginated.dto.ts` | `paginatedDto(ItemDto)` — Zod DTO factory cho list endpoint: `{ items: ItemSchema[], page, limit, total }`. |
| `errors/error-code.ts` | `ErrorCode` enum + `statusToErrorCode(status): string`. |
| `interceptors/response.interceptor.ts` | Bọc success envelope; tách paginated shape; gắn `meta`. |
| `filters/http-exception.filter.ts` | **Viết lại**: emit error envelope với `code` + `details`; vẫn log `ZodSerializationException`. |

### 5.1 `response.types.ts` (phác thảo)

```ts
export type ResponseMeta = {
  timestamp: string;
  path: string;
  requestId: string;
  pagination?: PaginationMeta;
};

export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type SuccessResponse<T> = { success: true; data: T; meta: ResponseMeta };

export type ErrorDetail = { field: string; message: string };

export type ErrorResponse = {
  success: false;
  error: { code: string; message: string; details?: ErrorDetail[] };
  meta: ResponseMeta;
};
```

### 5.2 `paginated.dto.ts` (phác thảo)

```ts
import { createZodDto } from 'nestjs-zod';
import { z, type ZodType } from 'zod';

export function paginatedSchema<T extends ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  });
}

export function paginatedDto<T extends ZodType>(itemSchema: T) {
  return createZodDto(paginatedSchema(itemSchema));
}
```

> Lưu ý Date: items dùng lại `userResponseSchema` (đã có pattern `z.any().transform(...)`),
> nên `z.toJSONSchema()` cho Swagger không crash. **Không** dùng `z.date()`.

### 5.3 `error-code.ts` (phác thảo)

```ts
export enum ErrorCode {
  BAD_REQUEST = 'BAD_REQUEST',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  TOO_MANY_REQUESTS = 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

const STATUS_MAP: Record<number, ErrorCode> = {
  400: ErrorCode.BAD_REQUEST,
  401: ErrorCode.UNAUTHORIZED,
  403: ErrorCode.FORBIDDEN,
  404: ErrorCode.NOT_FOUND,
  409: ErrorCode.CONFLICT,
  422: ErrorCode.VALIDATION_ERROR,
  429: ErrorCode.TOO_MANY_REQUESTS,
  500: ErrorCode.INTERNAL_ERROR,
};

export function statusToErrorCode(status: number): string {
  return STATUS_MAP[status] ?? `HTTP_${status}`;
}
```

---

## 6. Error handling chi tiết

- Filter mở rộng từ `@Catch(HttpException)` → **`@Catch()`** để mọi lỗi lạ / non-HTTP cũng được chuẩn hóa thành `500 INTERNAL_ERROR`.
  - Prod: ẩn message thật (`"Internal server error"`); log đầy đủ stack server-side.
  - Dev: có thể trả message thật để debug (đọc `NODE_ENV` qua ConfigService / `process.env`).
- **Nest `HttpException`**: lấy `status` + body. Body của Nest có thể là string hoặc `{ message, error, statusCode }`. Chuẩn hóa:
  - `code = statusToErrorCode(status)`
  - `message` = message của exception (nếu body.message là mảng → đó là validation, xem dưới).
- **Validation** (`ZodValidationException` từ nestjs-zod, status 400):
  - `code = VALIDATION_ERROR`
  - `details` = flatten `ZodError.issues` → `{ field: issue.path.join('.'), message: issue.message }`.
- **`ZodSerializationException`**: là **bug server** (response không khớp DTO) → vẫn log như hiện tại, trả `500 INTERNAL_ERROR`, **không** lộ chi tiết Zod ra client.

---

## 7. Pagination — thay đổi data layer

- `UserRepository` (port) thêm: `abstract count(): Promise<number>;`
- `PrismaUserRepository`: `count() { return this.prisma.user.count(); }`
- `UsersService.findAll` đổi trả về:

```ts
async findAll(params: { page: number; limit: number }): Promise<{ items: User[]; total: number }> {
  const { page, limit } = params;
  const [items, total] = await Promise.all([
    this.users.findAll({ skip: (page - 1) * limit, take: limit }),
    this.users.count(),
  ]);
  return { items, total };
}
```

- `UsersController.findAll` trả về `{ items, page, limit, total }` và dùng `@ZodSerializerDto(paginatedDto(UserResponseDto))`.
- `ResponseInterceptor` tính `totalPages = Math.ceil(total / limit)`, `hasNext = page < totalPages`, `hasPrev = page > 1`.

> Chỉ `users.findAll` là list endpoint hiện có. Các endpoint khác trả single resource → không cần đổi service.

---

## 8. requestId

- Cấu hình `FastifyAdapter` với `genReqId`:

```ts
new FastifyAdapter({
  genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
});
```

- `ResponseInterceptor` và `HttpExceptionFilter` đọc `req.id`, set header `x-request-id` trên response (qua Fastify reply).
- Lấy reply: trong filter dùng `host.switchToHttp().getResponse()`; trong interceptor set qua `context.switchToHttp().getResponse()`.

---

## 9. Edge cases (xử lý tường minh)

- **Non-HTTP (RMQ microservice)**: cả interceptor và filter `if (context/host.getType() !== 'http') return ...` — bỏ qua, giống `LoggingInterceptor` hiện tại.
- **`/health`**: trả JSON → được bọc envelope, vẫn hợp lệ.
- **`/docs` (Swagger UI)**: do handler riêng của Swagger phục vụ, không qua interceptor của ta → không ảnh hưởng.
- **`auth/login`** (`{ accessToken }`) và **`auth/me`**: được bọc envelope như mọi success khác → `data: { accessToken }`, `data: { …user }`.
- **`auth/login`** không có `@ZodSerializerDto` → ZodSerializer bỏ qua, ResponseInterceptor vẫn bọc bình thường.

---

## 10. Swagger

- Định nghĩa schema envelope generic (success + error) và document một lần (ví dụ helper `ApiEnvelope`/`ApiErrorResponse` hoặc khai báo schema chung), tránh lặp field từng endpoint.
- List endpoint reference DTO từ `paginatedDto(UserResponseDto)`.
- Giữ nhẹ nhàng: không nhân bản chi tiết field; ưu tiên đúng `data` shape + ví dụ envelope.

---

## 11. Testing

Spec colocated cạnh source (theo convention dự án), mock repository PORT bằng `useValue`.

- `src/common/interceptors/response.interceptor.spec.ts`: single resource, paginated shape, non-http skip, set header `x-request-id`.
- `src/common/filters/http-exception.filter.spec.ts`: từng status → code, validation flatten `details`, unknown error → 500, `ZodSerializationException` → 500 + logged.
- `src/common/errors/error-code.spec.ts`: `statusToErrorCode` map + fallback `HTTP_<status>`.
- Cập nhật `users.service.spec.ts`: `findAll` trả `{ items, total }`, mock `count()`.
- Cập nhật `users.controller` test (nếu có) cho shape mới.

---

## 12. Phạm vi & files thay đổi

**Thêm mới:**
- `src/common/http/response.types.ts`
- `src/common/http/paginated.dto.ts`
- `src/common/errors/error-code.ts`
- `src/common/interceptors/response.interceptor.ts`
- 3 file spec mới (mục 11)

**Sửa:**
- `src/common/filters/http-exception.filter.ts` (viết lại)
- `src/app.module.ts` (đăng ký `ResponseInterceptor` trước `ZodSerializerInterceptor`)
- `src/main.ts` (`genReqId` cho FastifyAdapter)
- `src/modules/users/repositories/user.repository.ts` (+`count`)
- `src/modules/users/repositories/prisma-user.repository.ts` (+`count`)
- `src/modules/users/services/users.service.ts` (`findAll` trả `{ items, total }`)
- `src/modules/users/controllers/users.controller.ts` (paginated DTO)
- `src/modules/users/services/users.service.spec.ts` (cập nhật)

**Không đổi:** cách service/repository ném lỗi; Prisma error mapping; mọi DTO request.

---

## 13. YAGNI — cố ý loại bỏ

- Không tạo `AppException` / error-code taxonomy theo domain (đã chọn derive từ status).
- Không tạo barrel `index.ts`.
- Không refactor cách ném lỗi ở service.
- Không thêm i18n cho message lỗi.
