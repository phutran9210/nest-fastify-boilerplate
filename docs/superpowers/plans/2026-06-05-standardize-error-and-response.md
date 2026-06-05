# Standardize Error + Response Envelope — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wrap every HTTP response in a consistent envelope — `{ success, data, meta }` for success and `{ success, error, meta }` for errors — with a machine-readable error `code`, full pagination meta, and a correlation `requestId`.

**Architecture:** Approach A from the spec — two cooperating global interceptors. `ResponseInterceptor` is registered **before** `ZodSerializerInterceptor` so on the response path Zod serializes the inner data first, then `ResponseInterceptor` wraps it. A rewritten catch-all `HttpExceptionFilter` produces the error envelope, deriving `code` from HTTP status. Errors are still raised as ordinary Nest exceptions — no change to how services throw.

**Tech Stack:** NestJS 11 + Fastify, nestjs-zod + Zod 4, Prisma 7, `@js-temporal/polyfill`, Jest, Biome, pnpm.

**Spec:** `docs/superpowers/specs/2026-06-05-standardize-error-and-response-design.md`

---

## File Structure

**New files**
- `src/common/http/response.types.ts` — wire-contract TS types.
- `src/common/http/paginated.schema.ts` — `paginatedSchema(item)` Zod factory (reusable across features).
- `src/common/http/error-response.dto.ts` — Zod DTO mirroring the error envelope (for Swagger).
- `src/common/http/api-envelope.decorator.ts` — `ApiEnvelopeResponse` + `ApiStandardErrorResponses` Swagger helpers.
- `src/common/errors/error-code.ts` — `ErrorCode` enum + `statusToErrorCode()`.
- `src/common/interceptors/response.interceptor.ts` — success-envelope interceptor.
- `src/modules/users/dto/paginated-users-response.dto.ts` — `PaginatedUsersResponseDto`.
- Specs: `error-code.spec.ts`, `response.interceptor.spec.ts`, `http-exception.filter.spec.ts` (colocated).

**Modified files**
- `src/common/filters/http-exception.filter.ts` — rewritten to emit the error envelope.
- `src/app.module.ts` — register `ResponseInterceptor` before `ZodSerializerInterceptor`.
- `src/main.ts` — Fastify `genReqId` (honor `x-request-id`).
- `src/modules/users/repositories/user.repository.ts` — add `count()`.
- `src/modules/users/repositories/prisma-user.repository.ts` — implement `count()`.
- `src/modules/users/services/users.service.ts` — `findAll` returns `{ items, total }`.
- `src/modules/users/services/users.service.spec.ts` — update `findAll` test + mock.
- `src/modules/users/controllers/users.controller.ts` — paginated DTO + shape.

---

## Task 1: Wire-contract types + error-code map

**Files:**
- Create: `src/common/http/response.types.ts`
- Create: `src/common/errors/error-code.ts`
- Test: `src/common/errors/error-code.spec.ts`

- [ ] **Step 1: Write the wire-contract types**

Create `src/common/http/response.types.ts`:

```ts
export type PaginationMeta = {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrev: boolean;
};

export type ResponseMeta = {
  timestamp: string;
  path: string;
  requestId: string;
  pagination?: PaginationMeta;
};

export type SuccessResponse<T> = {
  success: true;
  data: T;
  meta: ResponseMeta;
};

export type ErrorDetail = {
  field: string;
  message: string;
};

export type ErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    details?: ErrorDetail[];
  };
  meta: ResponseMeta;
};
```

- [ ] **Step 2: Write the failing test for `statusToErrorCode`**

Create `src/common/errors/error-code.spec.ts`:

```ts
import { ErrorCode, statusToErrorCode } from './error-code';

describe('statusToErrorCode', () => {
  it.each([
    [400, ErrorCode.BAD_REQUEST],
    [401, ErrorCode.UNAUTHORIZED],
    [403, ErrorCode.FORBIDDEN],
    [404, ErrorCode.NOT_FOUND],
    [409, ErrorCode.CONFLICT],
    [422, ErrorCode.VALIDATION_ERROR],
    [429, ErrorCode.TOO_MANY_REQUESTS],
    [500, ErrorCode.INTERNAL_ERROR],
  ])('maps %i to %s', (status, code) => {
    expect(statusToErrorCode(status)).toBe(code);
  });

  it('falls back to HTTP_<status> for unmapped statuses', () => {
    expect(statusToErrorCode(418)).toBe('HTTP_418');
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `pnpm test -- error-code`
Expected: FAIL — `Cannot find module './error-code'`.

- [ ] **Step 4: Implement `error-code.ts`**

Create `src/common/errors/error-code.ts`:

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

// Derive a machine-readable code from an HTTP status. Unmapped statuses fall back to
// `HTTP_<status>` so the client always gets a stable, non-empty code.
export function statusToErrorCode(status: number): string {
  return STATUS_MAP[status] ?? `HTTP_${status}`;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm test -- error-code`
Expected: PASS (9 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/common/http/response.types.ts src/common/errors/error-code.ts src/common/errors/error-code.spec.ts
git commit -m "feat(common): add response envelope types + error-code map"
```

---

## Task 2: ResponseInterceptor (success envelope)

**Files:**
- Create: `src/common/interceptors/response.interceptor.ts`
- Test: `src/common/interceptors/response.interceptor.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/common/interceptors/response.interceptor.spec.ts`:

```ts
import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from './response.interceptor';

function httpContext(req: unknown, res: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as never;
}

describe('ResponseInterceptor', () => {
  const interceptor = new ResponseInterceptor();

  it('wraps a single resource in the success envelope and echoes the request id', async () => {
    const req = { id: 'req-1', url: '/users/1' };
    const res = { header: jest.fn() };
    const handler = { handle: () => of({ id: '1', email: 'a@b.com' }) } as never;

    const result = (await lastValueFrom(
      interceptor.intercept(httpContext(req, res), handler),
    )) as Record<string, any>;

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ id: '1', email: 'a@b.com' });
    expect(result.meta.path).toBe('/users/1');
    expect(result.meta.requestId).toBe('req-1');
    expect(typeof result.meta.timestamp).toBe('string');
    expect(result.meta.pagination).toBeUndefined();
    expect(res.header).toHaveBeenCalledWith('x-request-id', 'req-1');
  });

  it('lifts a paginated payload into data + pagination meta', async () => {
    const req = { id: 'req-2', url: '/users' };
    const res = { header: jest.fn() };
    const payload = { items: [{ id: '1' }], page: 1, limit: 20, total: 57 };
    const handler = { handle: () => of(payload) } as never;

    const result = (await lastValueFrom(
      interceptor.intercept(httpContext(req, res), handler),
    )) as Record<string, any>;

    expect(result.data).toEqual([{ id: '1' }]);
    expect(result.meta.pagination).toEqual({
      page: 1,
      limit: 20,
      total: 57,
      totalPages: 3,
      hasNext: true,
      hasPrev: false,
    });
  });

  it('skips non-http contexts (e.g. RMQ)', async () => {
    const ctx = { getType: () => 'rpc' } as never;
    const handler = { handle: () => of('raw') } as never;
    const result = await lastValueFrom(interceptor.intercept(ctx, handler));
    expect(result).toBe('raw');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- response.interceptor`
Expected: FAIL — `Cannot find module './response.interceptor'`.

- [ ] **Step 3: Implement the interceptor**

Create `src/common/interceptors/response.interceptor.ts`:

```ts
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
import { Temporal } from '@js-temporal/polyfill';
import type { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { PaginationMeta, ResponseMeta, SuccessResponse } from '../http/response.types';

type PaginatedPayload = { items: unknown[]; page: number; limit: number; total: number };

// List endpoints return the `paginatedSchema` shape; detect it so we can lift `items` into
// `data` and move page/limit/total into `meta.pagination`.
function isPaginated(v: unknown): v is PaginatedPayload {
  return (
    !!v &&
    typeof v === 'object' &&
    'items' in v &&
    Array.isArray((v as { items: unknown }).items) &&
    'page' in v &&
    'limit' in v &&
    'total' in v
  );
}

function buildPagination(page: number, limit: number, total: number): PaginationMeta {
  const totalPages = limit > 0 ? Math.ceil(total / limit) : 0;
  return { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 };
}

@Injectable()
export class ResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    // Only envelope HTTP responses; microservice (RMQ) contexts have no reply to wrap.
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const res = context.switchToHttp().getResponse();
    const requestId = String(req?.id ?? '');
    const path: string = req?.url ?? '';

    if (requestId && typeof res?.header === 'function') {
      res.header('x-request-id', requestId);
    }

    return next.handle().pipe(
      map((payload): SuccessResponse<unknown> => {
        const meta: ResponseMeta = {
          timestamp: Temporal.Now.instant().toString({ smallestUnit: 'millisecond' }),
          path,
          requestId,
        };
        if (isPaginated(payload)) {
          meta.pagination = buildPagination(payload.page, payload.limit, payload.total);
          return { success: true, data: payload.items, meta };
        }
        return { success: true, data: payload, meta };
      }),
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- response.interceptor`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/interceptors/response.interceptor.ts src/common/interceptors/response.interceptor.spec.ts
git commit -m "feat(common): add ResponseInterceptor for success envelope"
```

---

## Task 3: Rewrite HttpExceptionFilter (error envelope)

**Files:**
- Modify: `src/common/filters/http-exception.filter.ts` (full rewrite)
- Test: `src/common/filters/http-exception.filter.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/common/filters/http-exception.filter.spec.ts`:

```ts
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { HttpExceptionFilter } from './http-exception.filter';

function host(req: unknown, res: unknown) {
  return {
    getType: () => 'http',
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
  } as never;
}

describe('HttpExceptionFilter', () => {
  const config = { get: jest.fn().mockReturnValue('test') } as never;
  let filter: HttpExceptionFilter;
  let res: { status: jest.Mock; send: jest.Mock; header: jest.Mock };
  const req = { id: 'req-1', url: '/users' };

  const body = () => res.send.mock.calls[0][0];

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new HttpExceptionFilter(config);
    res = {
      status: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis(),
      header: jest.fn(),
    };
  });

  it('maps NotFoundException to 404 / NOT_FOUND', () => {
    filter.catch(new NotFoundException('User 1 not found'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(404);
    expect(body().success).toBe(false);
    expect(body().error.code).toBe('NOT_FOUND');
    expect(body().error.message).toBe('User 1 not found');
    expect(body().meta.requestId).toBe('req-1');
    expect(res.header).toHaveBeenCalledWith('x-request-id', 'req-1');
  });

  it('maps ConflictException to 409 / CONFLICT', () => {
    filter.catch(new ConflictException('Email taken'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(409);
    expect(body().error.code).toBe('CONFLICT');
  });

  it('flattens ZodValidationException issues into error.details', () => {
    const zodError = new ZodError([
      { code: 'custom', path: ['email'], message: 'Invalid email' } as never,
    ]);
    filter.catch(new ZodValidationException(zodError), host(req, res));
    expect(res.status).toHaveBeenCalledWith(400);
    expect(body().error.code).toBe('VALIDATION_ERROR');
    expect(body().error.details).toEqual([{ field: 'email', message: 'Invalid email' }]);
  });

  it('maps unknown errors to 500 / INTERNAL_ERROR', () => {
    filter.catch(new Error('boom'), host(req, res));
    expect(res.status).toHaveBeenCalledWith(500);
    expect(body().error.code).toBe('INTERNAL_ERROR');
  });

  it('hides the unknown-error message in production', () => {
    (config as { get: jest.Mock }).get.mockReturnValue('production');
    filter.catch(new Error('secret detail'), host(req, res));
    expect(body().error.message).toBe('Internal server error');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- http-exception.filter`
Expected: FAIL — current filter has no `code`/envelope; assertions on `body().error.code` fail (and constructor takes no `ConfigService`).

- [ ] **Step 3: Rewrite the filter**

Replace the entire contents of `src/common/filters/http-exception.filter.ts`:

```ts
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Temporal } from '@js-temporal/polyfill';
import { ZodSerializationException, ZodValidationException } from 'nestjs-zod';
import { ZodError } from 'zod';
import { statusToErrorCode } from '../errors/error-code';
import type { ErrorDetail, ErrorResponse } from '../http/response.types';

// Pull a human-readable message out of a Nest HttpException (body can be a string or an
// object with a string/array `message`).
function extractMessage(exception: HttpException): string {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return response;
  }
  if (response && typeof response === 'object' && 'message' in response) {
    const message = (response as { message: unknown }).message;
    if (Array.isArray(message)) {
      return message.join(', ');
    }
    if (typeof message === 'string') {
      return message;
    }
  }
  return exception.message;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  constructor(private readonly config: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    // Non-HTTP (RMQ) contexts have no reply to write; let the transport handle it.
    if (host.getType() !== 'http') {
      throw exception;
    }

    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const requestId = String(req?.id ?? '');

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';
    let details: ErrorDetail[] | undefined;

    if (exception instanceof ZodSerializationException) {
      // Response did not match its DTO — a server bug. Log it; never leak details to the client.
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        this.logger.error(`ZodSerializationException: ${zodError.message}`);
      }
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message = 'Internal server error';
    } else if (exception instanceof ZodValidationException) {
      // Must be checked before HttpException — ZodValidationException extends BadRequestException.
      status = HttpStatus.BAD_REQUEST;
      message = 'Validation failed';
      const zodError = exception.getZodError();
      if (zodError instanceof ZodError) {
        details = zodError.issues.map((issue) => ({
          field: issue.path.join('.'),
          message: issue.message,
        }));
      }
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = extractMessage(exception);
    } else {
      status = HttpStatus.INTERNAL_SERVER_ERROR;
      message =
        this.config.get('NODE_ENV') === 'production'
          ? 'Internal server error'
          : exception instanceof Error
            ? exception.message
            : String(exception);
    }

    if (status >= HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(exception instanceof Error ? (exception.stack ?? exception.message) : String(exception));
    }

    const responseBody: ErrorResponse = {
      success: false,
      error: {
        code: statusToErrorCode(status),
        message,
        ...(details ? { details } : {}),
      },
      meta: {
        timestamp: Temporal.Now.instant().toString({ smallestUnit: 'millisecond' }),
        path: req?.url ?? '',
        requestId,
      },
    };

    if (requestId && typeof res.header === 'function') {
      res.header('x-request-id', requestId);
    }
    res.status(status).send(responseBody);
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- http-exception.filter`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/common/filters/http-exception.filter.ts src/common/filters/http-exception.filter.spec.ts
git commit -m "feat(common): error envelope filter with status->code mapping"
```

---

## Task 4: Wire interceptor + Fastify genReqId

**Files:**
- Modify: `src/app.module.ts`
- Modify: `src/main.ts`

- [ ] **Step 1: Register `ResponseInterceptor` before `ZodSerializerInterceptor`**

In `src/app.module.ts`, add the import near the other interceptor import:

```ts
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
```

Then in the `providers` array, change the interceptor block so `ResponseInterceptor` sits **between** `LoggingInterceptor` and `ZodSerializerInterceptor` (order matters — on the response path Zod serializes first, then ResponseInterceptor wraps):

```ts
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
    { provide: APP_INTERCEPTOR, useClass: ZodSerializerInterceptor },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
```

- [ ] **Step 2: Configure Fastify `genReqId` to honor `x-request-id`**

In `src/main.ts`, add at the top:

```ts
import { randomUUID } from 'node:crypto';
```

Change the adapter construction:

```ts
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      // Reuse an inbound correlation id if present; otherwise generate one. Surfaced back to
      // the client as `x-request-id` by ResponseInterceptor / HttpExceptionFilter.
      genReqId: (req) => (req.headers['x-request-id'] as string) ?? randomUUID(),
    }),
  );
```

- [ ] **Step 3: Verify the app boots and the envelope appears end-to-end**

Run: `pnpm typecheck`
Expected: no type errors.

Run (manual smoke, optional — requires DB/Redis/RabbitMQ): `pnpm start:dev`, then:

```bash
curl -i http://localhost:3000/health
```

Expected: `x-request-id` header present and a body shaped like `{"success":true,"data":{...},"meta":{"timestamp":...,"path":"/health","requestId":...}}`.

- [ ] **Step 4: Commit**

```bash
git add src/app.module.ts src/main.ts
git commit -m "feat: wire ResponseInterceptor + fastify genReqId correlation"
```

---

## Task 5: Users pagination data layer

**Files:**
- Modify: `src/modules/users/repositories/user.repository.ts`
- Modify: `src/modules/users/repositories/prisma-user.repository.ts`
- Modify: `src/modules/users/services/users.service.ts`
- Test: `src/modules/users/services/users.service.spec.ts`

- [ ] **Step 1: Update the failing service test**

In `src/modules/users/services/users.service.spec.ts`, add `count` to the repo mock object:

```ts
  const repo = {
    findById: jest.fn(),
    findByEmail: jest.fn(),
    findAll: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    count: jest.fn(),
  };
```

Replace the existing `findAll translates page/limit into skip/take` test with:

```ts
  it('findAll returns items + total and translates page/limit into skip/take', async () => {
    const items = [{ id: '1', email: 'a@b.com', password: 'hash', name: null }];
    repo.findAll.mockResolvedValue(items);
    repo.count.mockResolvedValue(57);
    const result = await service.findAll({ page: 3, limit: 10 });
    expect(repo.findAll).toHaveBeenCalledWith({ skip: 20, take: 10 });
    expect(repo.count).toHaveBeenCalled();
    expect(result).toEqual({ items, total: 57 });
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- users.service`
Expected: FAIL — `service.findAll` still resolves to an array, not `{ items, total }`; `repo.count` not called.

- [ ] **Step 3: Add `count()` to the repository port**

In `src/modules/users/repositories/user.repository.ts`, add to the abstract class:

```ts
  abstract count(): Promise<number>;
```

- [ ] **Step 4: Implement `count()` in the Prisma repository**

In `src/modules/users/repositories/prisma-user.repository.ts`, add the method (e.g. after `findAll`):

```ts
  count(): Promise<number> {
    return this.prisma.user.count();
  }
```

- [ ] **Step 5: Update the service `findAll`**

In `src/modules/users/services/users.service.ts`, replace `findAll`:

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

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm test -- users.service`
Expected: PASS (all tests, including the updated `findAll`).

- [ ] **Step 7: Commit**

```bash
git add src/modules/users/repositories/user.repository.ts src/modules/users/repositories/prisma-user.repository.ts src/modules/users/services/users.service.ts src/modules/users/services/users.service.spec.ts
git commit -m "feat(users): paginated findAll returning items + total"
```

---

## Task 6: Paginated users DTO + controller

**Files:**
- Create: `src/common/http/paginated.schema.ts`
- Create: `src/modules/users/dto/paginated-users-response.dto.ts`
- Modify: `src/modules/users/controllers/users.controller.ts`

- [ ] **Step 1: Create the reusable paginated schema factory**

Create `src/common/http/paginated.schema.ts`:

```ts
import { z, type ZodType } from 'zod';

// Reusable list-response shape. The ResponseInterceptor detects this shape and lifts
// `items` -> `data`, moving page/limit/total into `meta.pagination`.
export function paginatedSchema<T extends ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
  });
}
```

- [ ] **Step 2: Create the paginated users DTO**

Create `src/modules/users/dto/paginated-users-response.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { paginatedSchema } from '../../../common/http/paginated.schema';
import { userResponseSchema } from './user-response.dto';

export const paginatedUsersResponseSchema = paginatedSchema(userResponseSchema);

export class PaginatedUsersResponseDto extends (createZodDto(
  paginatedUsersResponseSchema,
) as ReturnType<typeof createZodDto<typeof paginatedUsersResponseSchema>>) {}
```

- [ ] **Step 3: Update the controller `findAll`**

In `src/modules/users/controllers/users.controller.ts`:

Add the import:

```ts
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
```

Replace the `findAll` handler:

```ts
  @Get()
  @ZodSerializerDto(PaginatedUsersResponseDto)
  @ApiOkResponse({ type: PaginatedUsersResponseDto })
  async findAll(@Query() query: ListUsersQueryDto) {
    const { items, total } = await this.users.findAll(query);
    return { items, total, page: query.page, limit: query.limit };
  }
```

- [ ] **Step 4: Verify types + boot-relevant Swagger generation**

Run: `pnpm typecheck`
Expected: no errors (confirms `userResponseSchema`/`paginatedSchema` types line up).

Run: `pnpm test -- users`
Expected: PASS — no regressions in users specs.

- [ ] **Step 5: Commit**

```bash
git add src/common/http/paginated.schema.ts src/modules/users/dto/paginated-users-response.dto.ts src/modules/users/controllers/users.controller.ts
git commit -m "feat(users): paginated list response DTO + controller shape"
```

---

## Task 7: Swagger — document the envelope (lightweight)

**Files:**
- Create: `src/common/http/error-response.dto.ts`
- Create: `src/common/http/api-envelope.decorator.ts`
- Modify: `src/modules/users/controllers/users.controller.ts`
- Modify: `src/modules/auth/controllers/auth.controller.ts`

> Rationale: a single reusable error DTO + two combined decorators keep Swagger accurate without
> per-field duplication on every route. Success responses are documented via an `allOf` wrap that
> references the existing item DTOs (no schema duplication).

- [ ] **Step 1: Create the error-response DTO (for Swagger schema)**

Create `src/common/http/error-response.dto.ts`:

```ts
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const errorResponseSchema = z.object({
  success: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z
      .array(z.object({ field: z.string(), message: z.string() }))
      .optional(),
  }),
  meta: z.object({
    timestamp: z.string(),
    path: z.string(),
    requestId: z.string(),
  }),
});

export class ErrorResponseDto extends (createZodDto(errorResponseSchema) as ReturnType<
  typeof createZodDto<typeof errorResponseSchema>
>) {}
```

- [ ] **Step 2: Create the Swagger envelope decorators**

Create `src/common/http/api-envelope.decorator.ts`:

```ts
import { applyDecorators, type Type } from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiExtraModels,
  ApiInternalServerErrorResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiUnauthorizedResponse,
  getSchemaPath,
} from '@nestjs/swagger';
import { ErrorResponseDto } from './error-response.dto';

// Document a success response wrapped in the standard envelope, referencing `model` for `data`.
export function ApiEnvelopeResponse<TModel extends Type<unknown>>(model: TModel, isArray = false) {
  const data = isArray
    ? { type: 'array' as const, items: { $ref: getSchemaPath(model) } }
    : { $ref: getSchemaPath(model) };
  return applyDecorators(
    ApiExtraModels(model),
    ApiOkResponse({
      schema: {
        type: 'object',
        properties: {
          success: { type: 'boolean', example: true },
          data,
          meta: { type: 'object' },
        },
      },
    }),
  );
}

// Document the common error responses with the shared error envelope DTO.
export function ApiStandardErrorResponses() {
  return applyDecorators(
    ApiExtraModels(ErrorResponseDto),
    ApiBadRequestResponse({ type: ErrorResponseDto }),
    ApiUnauthorizedResponse({ type: ErrorResponseDto }),
    ApiNotFoundResponse({ type: ErrorResponseDto }),
    ApiInternalServerErrorResponse({ type: ErrorResponseDto }),
  );
}
```

- [ ] **Step 3: Apply the error decorator to the controllers**

In `src/modules/users/controllers/users.controller.ts`, add the import and apply at class level:

```ts
import { ApiStandardErrorResponses } from '../../../common/http/api-envelope.decorator';
```

Add `@ApiStandardErrorResponses()` directly under `@ApiTags('users')` on the controller class.

In `src/modules/auth/controllers/auth.controller.ts`, add the same import and apply `@ApiStandardErrorResponses()` under `@ApiTags('auth')`.

- [ ] **Step 4: Verify the Swagger document builds (app boots)**

Run: `pnpm typecheck`
Expected: no errors.

Run: `pnpm build`
Expected: build succeeds (confirms `z.toJSONSchema()` for the new DTOs does not crash — no `z.date()` used).

- [ ] **Step 5: Commit**

```bash
git add src/common/http/error-response.dto.ts src/common/http/api-envelope.decorator.ts src/modules/users/controllers/users.controller.ts src/modules/auth/controllers/auth.controller.ts
git commit -m "docs(swagger): document standard error envelope on controllers"
```

---

## Task 8: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Lint + format**

Run: `pnpm check`
Expected: Biome reports no remaining issues (auto-fixes applied). Review and `git add -p` any formatting changes.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: no errors.

- [ ] **Step 3: Build (proves Swagger/Zod JSON-schema generation is safe)**

Run: `pnpm build`
Expected: success.

- [ ] **Step 4: Full test suite**

Run: `pnpm test`
Expected: all suites pass — new `error-code`, `response.interceptor`, `http-exception.filter` specs plus existing `users.service` / `auth.service` specs.

- [ ] **Step 5: Commit any formatting fixups**

```bash
git add -A
git commit -m "chore: format + lint fixups for response standardization" || echo "nothing to commit"
```

---

## Self-Review Notes (already reconciled against the spec)

- **Success envelope** → Tasks 2, 4. **Error envelope + code** → Tasks 1, 3. **Errors stay Nest exceptions** → Task 3 (filter derives code; services untouched). **Full pagination meta** → Tasks 2, 5, 6. **requestId via header ↔ req.id** → Tasks 2, 3, 4. **Edge cases (non-http skip)** → Tasks 2, 3. **Swagger lightweight** → Task 7.
- **Type consistency:** `ResponseMeta`/`PaginationMeta`/`ErrorResponse`/`ErrorDetail` (Task 1) are the only response types referenced by the interceptor (Task 2) and filter (Task 3). The paginated wire shape `{ items, page, limit, total }` is produced identically by `paginatedSchema` (Task 6), the controller (Task 6), and detected by `isPaginated` (Task 2).
- **Date convention:** timestamps use `Temporal.Now.instant().toString(...)`; all new response DTOs reuse `userResponseSchema`'s `z.any().transform(...)` date handling — no `z.date()`, so `z.toJSONSchema()` (Swagger) will not crash.
```
