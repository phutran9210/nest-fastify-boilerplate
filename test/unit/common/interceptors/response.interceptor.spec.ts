import { lastValueFrom, of } from 'rxjs';
import { ResponseInterceptor } from '@common/interceptors/response.interceptor';

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

  it('returns totalPages 0 when limit is 0', async () => {
    const req = { id: 'req-3', url: '/users' };
    const res = { header: jest.fn() };
    const payload = { items: [], page: 1, limit: 0, total: 0 };
    const handler = { handle: () => of(payload) } as never;

    const result = (await lastValueFrom(
      interceptor.intercept(httpContext(req, res), handler),
    )) as Record<string, any>;

    expect(result.meta.pagination).toEqual({
      page: 1,
      limit: 0,
      total: 0,
      totalPages: 0,
      hasNext: false,
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
