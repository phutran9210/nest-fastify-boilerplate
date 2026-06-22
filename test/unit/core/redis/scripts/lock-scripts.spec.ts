import { acquireLock } from '@core/redis/scripts/acquire-lock.lua';
import { extendLock } from '@core/redis/scripts/extend-lock.lua';
import { releaseLock } from '@core/redis/scripts/release-lock.lua';

describe('lock Lua scripts', () => {
  it('extendLock: 1 key, PEXPIRE chỉ khi token khớp', () => {
    expect(extendLock.numberOfKeys).toBe(1);
    expect(extendLock.lua).toContain('pexpire');
    expect(extendLock.lua).toContain('ARGV[1]'); // token compare
  });

  it('acquireLock: 2 keys, INCR có điều kiện theo ARGV[3]', () => {
    expect(acquireLock.numberOfKeys).toBe(2);
    expect(acquireLock.lua).toContain('ARGV[3]'); // fencing flag
    expect(acquireLock.lua).toContain('incr');
    expect(acquireLock.lua).toContain('set'); // SET NX PX vẫn còn
  });

  it('releaseLock không đổi: 1 key, compare-then-del', () => {
    expect(releaseLock.numberOfKeys).toBe(1);
    expect(releaseLock.lua).toContain('del');
  });
});
