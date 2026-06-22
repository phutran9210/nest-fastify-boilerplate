import { AppException } from '@common/exceptions/app.exception';
import { LockService } from '@core/redis/ports/lock.service.port';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { RedisLockService } from '@core/redis/services/lock.service';
import { Test } from '@nestjs/testing';

describe('RedisLockService', () => {
  const client = { acquireLock: jest.fn(), releaseLock: jest.fn(), extendLock: jest.fn() };
  let service: LockService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef = await Test.createTestingModule({
      providers: [
        { provide: LockService, useClass: RedisLockService },
        { provide: REDIS_CLIENT, useValue: client },
      ],
    }).compile();
    service = moduleRef.get(LockService);
  });

  it('acquire mặc định KHÔNG fencing: fencingToken=null, gọi 5 arg cờ "0"', async () => {
    client.acquireLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(lock).toMatchObject({ key: 'job', fencingToken: null });
    expect(typeof lock?.token).toBe('string');
    expect(client.acquireLock).toHaveBeenCalledWith(
      'lock:job', 'lock:fence:job', expect.any(String), 5000, '0',
    );
  });

  it('acquire fencing:true: fencingToken là số, cờ "1"', async () => {
    client.acquireLock.mockResolvedValue(7);
    const lock = await service.acquire('job', 5000, { fencing: true });
    expect(lock).toMatchObject({ fencingToken: 7 });
    expect(client.acquireLock).toHaveBeenCalledWith(
      'lock:job', 'lock:fence:job', expect.any(String), 5000, '1',
    );
  });

  it('acquire trả null khi script trả null (đã bị giữ)', async () => {
    client.acquireLock.mockResolvedValue(null);
    expect(await service.acquire('job', 5000)).toBeNull();
  });

  it('lock.signal có sẵn và chưa abort khi mới acquire', async () => {
    client.acquireLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(lock?.signal.aborted).toBe(false);
  });

  it('extend gọi extendLock đúng token, true khi trả 1', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.extendLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.extend(5000)).toBe(true);
    expect(client.extendLock).toHaveBeenCalledWith('lock:job', lock?.token, 5000);
  });

  it('release del đúng token, true khi trả 1', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.release()).toBe(true);
    expect(client.releaseLock).toHaveBeenCalledWith('lock:job', lock?.token);
  });

  it('validate: ttl<=0 ném lỗi lập trình', async () => {
    await expect(service.acquire('job', 0)).rejects.toThrow();
  });

  it('validate: autoRenew với ttl<3000 ném lỗi', async () => {
    await expect(service.acquire('job', 2000, { autoRenew: true })).rejects.toThrow();
  });

  it('validate: retry.minDelayMs/maxDelayMs = NaN bị reject', async () => {
    await expect(
      service.acquire('job', 5000, { retry: { waitMs: 10, minDelayMs: Number.NaN } }),
    ).rejects.toThrow();
    await expect(
      service.acquire('job', 5000, { retry: { waitMs: 10, maxDelayMs: Number.NaN } }),
    ).rejects.toThrow();
  });

  it('withLock chạy fn rồi release', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    const out = await service.withLock('job', 5000, async () => 'done');
    expect(out).toBe('done');
    expect(client.releaseLock).toHaveBeenCalled();
  });

  it('withLock release kể cả khi fn ném', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    await expect(
      service.withLock('job', 5000, async () => { throw new Error('boom'); }),
    ).rejects.toThrow('boom');
    expect(client.releaseLock).toHaveBeenCalled();
  });

  it('withLock ném AppException(409) khi không acquire (default throw)', async () => {
    client.acquireLock.mockResolvedValue(null);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toBeInstanceOf(AppException);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toMatchObject({ status: 409 });
  });

  it('withLock onTimeout:return trả undefined, KHÔNG chạy fn', async () => {
    client.acquireLock.mockResolvedValue(null);
    const fn = jest.fn();
    const out = await service.withLock('job', 5000, fn, { onTimeout: 'return' });
    expect(out).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  it('acquire retry: fail lần đầu, success trong waitMs', async () => {
    client.acquireLock.mockResolvedValueOnce(null).mockResolvedValueOnce(1);
    const lock = await service.acquire('job', 5000, { retry: { waitMs: 1000, minDelayMs: 1, maxDelayMs: 2 } });
    expect(lock).not.toBeNull();
    expect(client.acquireLock).toHaveBeenCalledTimes(2);
  });

  it('acquire retry: hết deadline vẫn fail → null', async () => {
    client.acquireLock.mockResolvedValue(null);
    const lock = await service.acquire('job', 5000, { retry: { waitMs: 30, minDelayMs: 1, maxDelayMs: 2 } });
    expect(lock).toBeNull();
    expect(client.acquireLock.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('acquire retry waitMs=0: vẫn thử đúng 1 lần', async () => {
    client.acquireLock.mockResolvedValue(null);
    const lock = await service.acquire('job', 5000, { retry: { waitMs: 0 } });
    expect(lock).toBeNull();
    expect(client.acquireLock).toHaveBeenCalledTimes(1);
  });

  it('withLock retry hết hạn + onTimeout:return → undefined', async () => {
    client.acquireLock.mockResolvedValue(null);
    const fn = jest.fn();
    const out = await service.withLock('job', 5000, fn, { retry: { waitMs: 20, minDelayMs: 1, maxDelayMs: 2 }, onTimeout: 'return' });
    expect(out).toBeUndefined();
    expect(fn).not.toHaveBeenCalled();
  });

  describe('watchdog auto-renew', () => {
    beforeEach(() => jest.useFakeTimers());
    afterEach(() => jest.useRealTimers());

    it('gia hạn ở nhịp ttl/3 và dừng khi release', async () => {
      client.acquireLock.mockResolvedValue(1);
      client.releaseLock.mockResolvedValue(1);
      client.extendLock.mockResolvedValue(1);
      const lock = await service.acquire('job', 3000, { autoRenew: true });
      await jest.advanceTimersByTimeAsync(1000); // ttl/3 = 1000ms
      expect(client.extendLock).toHaveBeenCalledTimes(1);
      await jest.advanceTimersByTimeAsync(1000);
      expect(client.extendLock).toHaveBeenCalledTimes(2);
      await lock?.release();
      await jest.advanceTimersByTimeAsync(5000);
      expect(client.extendLock).toHaveBeenCalledTimes(2); // không gia hạn thêm sau release
    });

    it('mất lock (extend→0): abort signal + dừng watchdog', async () => {
      client.acquireLock.mockResolvedValue(1);
      client.releaseLock.mockResolvedValue(0);
      client.extendLock.mockResolvedValue(0);
      const lock = await service.acquire('job', 3000, { autoRenew: true });
      expect(lock?.signal.aborted).toBe(false);
      await jest.advanceTimersByTimeAsync(1000);
      expect(lock?.signal.aborted).toBe(true);
      await jest.advanceTimersByTimeAsync(3000);
      expect(client.extendLock).toHaveBeenCalledTimes(1); // dừng sau khi mất
      await lock?.release();
    });

    it('extend reject: KHÔNG crash, lên lịch tiếp', async () => {
      client.acquireLock.mockResolvedValue(1);
      client.releaseLock.mockResolvedValue(1);
      client.extendLock.mockRejectedValueOnce(new Error('redis down')).mockResolvedValue(1);
      const lock = await service.acquire('job', 3000, { autoRenew: true });
      await jest.advanceTimersByTimeAsync(1000);
      await jest.advanceTimersByTimeAsync(1000);
      expect(client.extendLock).toHaveBeenCalledTimes(2); // lần 1 reject, lần 2 vẫn chạy
      expect(lock?.signal.aborted).toBe(false);
      await lock?.release();
    });
  });
});
