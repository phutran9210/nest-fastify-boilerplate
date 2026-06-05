import { type ZodType, z } from 'zod';

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
