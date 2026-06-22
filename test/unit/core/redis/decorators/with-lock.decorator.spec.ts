import 'reflect-metadata';
import type { LockService } from '@core/redis/ports/lock.service.port';
import {
  WithLock,
  clearLockServiceRef, getLockServiceRef, setLockServiceRef,
} from '@core/redis/decorators/with-lock.decorator';

describe('lock service holder', () => {
  const svcA = {} as LockService;
  const svcB = {} as LockService;
  afterEach(() => {
    clearLockServiceRef(svcA);
    clearLockServiceRef(svcB);
  });

  it('getLockServiceRef ném khi chưa bootstrap', () => {
    expect(() => getLockServiceRef()).toThrow();
  });

  it('set rồi get trả đúng service', () => {
    setLockServiceRef(svcA);
    expect(getLockServiceRef()).toBe(svcA);
  });

  it('clear bởi đúng chủ sở hữu mới xoá', () => {
    setLockServiceRef(svcA);
    clearLockServiceRef(svcB); // không phải chủ → no-op
    expect(getLockServiceRef()).toBe(svcA);
    clearLockServiceRef(svcA);
    expect(() => getLockServiceRef()).toThrow();
  });

  it('ghi đè bởi context khác → warn (không silent)', () => {
    const warn = jest.spyOn(require('@nestjs/common').Logger.prototype, 'warn').mockImplementation();
    setLockServiceRef(svcA);
    setLockServiceRef(svcB);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('@WithLock', () => {
  const withLock = jest.fn();
  beforeEach(() => {
    jest.clearAllMocks();
    setLockServiceRef({ withLock } as unknown as LockService);
  });

  it('dựng key qua factory + truyền opts xuống withLock; trả kết quả fn', async () => {
    withLock.mockImplementation(async (_k, _ttl, fn) => fn({ signal: { aborted: false } }));
    class Svc {
      @WithLock({ key: (id: string) => `user:${id}:sync`, ttlMs: 30_000, retry: { waitMs: 5000 } })
      async sync(id: string) { return `synced:${id}`; }
    }
    const out = await new Svc().sync('42');
    expect(out).toBe('synced:42');
    expect(withLock).toHaveBeenCalledWith('user:42:sync', 30_000, expect.any(Function), {
      retry: { waitMs: 5000 }, autoRenew: undefined, onTimeout: undefined,
    });
  });

  it('onTimeout:return → thân method không chạy khi withLock trả undefined', async () => {
    withLock.mockResolvedValue(undefined);
    const body = jest.fn();
    class Svc {
      @WithLock({ key: () => 'k', ttlMs: 5000, onTimeout: 'return' })
      async run() { body(); return 'x'; }
    }
    const out = await new Svc().run();
    expect(out).toBeUndefined();
    expect(body).not.toHaveBeenCalled();
  });

  it('copy reflect-metadata từ method gốc sang wrapper', async () => {
    withLock.mockImplementation(async (_k, _ttl, fn) => fn({}));
    const KEY = 'custom:meta';
    function Marker(): MethodDecorator {
      return (_t, _p, d) => { Reflect.defineMetadata(KEY, 'tagged', d.value as object); return d; };
    }
    class Svc {
      // @WithLock áp NGOÀI (chạy sau) Marker → phải giữ metadata Marker gắn lên hàm gốc
      @WithLock({ key: () => 'k', ttlMs: 5000 })
      @Marker()
      async handler() { return 1; }
    }
    const fn = Object.getOwnPropertyDescriptor(Svc.prototype, 'handler')?.value;
    expect(Reflect.getMetadata(KEY, fn)).toBe('tagged');
  });
});
