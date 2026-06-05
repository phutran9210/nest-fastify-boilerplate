import { Temporal } from '@js-temporal/polyfill';
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  type NestInterceptor,
} from '@nestjs/common';
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
