import { AppException } from '@common/exceptions/app.exception';
import { Test } from '@nestjs/testing';
import { REDIS_CLIENT } from '@core/redis/redis.constants';
import { LockService } from '@core/redis/ports/lock.service.port';
import { RedisLockService } from '@core/redis/services/lock.service';

describe('RedisLockService', () => {
  const client = { acquireLock: jest.fn(), releaseLock: jest.fn() };
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

  it('acquire trả Lock kèm fencingToken khi script trả số', async () => {
    client.acquireLock.mockResolvedValue(7);
    const lock = await service.acquire('job', 5000);
    expect(lock).toMatchObject({ key: 'job', fencingToken: 7 });
    expect(typeof lock?.token).toBe('string');
    // KEYS: lock:<key>, lock:fence:<key>; ARGV: token, ttl
    expect(client.acquireLock).toHaveBeenCalledWith(
      'lock:job',
      'lock:fence:job',
      expect.any(String),
      5000,
    );
  });

  it('acquire trả null khi script trả null (đã bị giữ)', async () => {
    client.acquireLock.mockResolvedValue(null);
    expect(await service.acquire('job', 5000)).toBeNull();
  });

  it('release del đúng token, trả true khi script trả 1', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(1);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.release()).toBe(true);
    expect(client.releaseLock).toHaveBeenCalledWith('lock:job', lock?.token);
  });

  it('release trả false khi script trả 0 (token lệch)', async () => {
    client.acquireLock.mockResolvedValue(1);
    client.releaseLock.mockResolvedValue(0);
    const lock = await service.acquire('job', 5000);
    expect(await lock?.release()).toBe(false);
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
      service.withLock('job', 5000, async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(client.releaseLock).toHaveBeenCalled();
  });

  it('withLock ném AppException(409) khi không acquire được', async () => {
    client.acquireLock.mockResolvedValue(null);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toBeInstanceOf(AppException);
    await expect(service.withLock('job', 5000, async () => 1)).rejects.toMatchObject({ status: 409 });
  });
});
