import { Logger } from '@nestjs/common';
import type { LockOptions, LockService } from '../ports/lock.service.port';

const holderLogger = new Logger('WithLock');
let lockServiceRef: LockService | null = null;

export function setLockServiceRef(s: LockService): void {
  if (lockServiceRef && lockServiceRef !== s) {
    holderLogger.warn('LockService ref bị ghi đè bởi context khác (multi-app/test?)');
  }
  lockServiceRef = s;
}

export function clearLockServiceRef(s: LockService): void {
  if (lockServiceRef === s) lockServiceRef = null; // chỉ chủ hiện tại được clear
}

export function getLockServiceRef(): LockService {
  if (!lockServiceRef) {
    throw new Error(
      'LockService chưa được bootstrap — RedisModule phải nạp trước khi dùng @WithLock.',
    );
  }
  return lockServiceRef;
}

export interface WithLockMetadata<A extends unknown[]> {
  key: (...args: A) => string;
  ttlMs: number;
  retry?: LockOptions['retry'];
  autoRenew?: boolean;
  onTimeout?: 'throw' | 'return';
}

// Signature gọn để gọi qua decorator: withLock có overload nên không khớp trực tiếp với
// một opts kiểu union — ép qua `unknown` (KHÔNG phải `any`) tới callable đơn này.
type WithLockCallable = (
  key: string,
  ttlMs: number,
  fn: () => Promise<unknown>,
  opts?: LockOptions,
) => Promise<unknown>;

export function WithLock<A extends unknown[]>(meta: WithLockMetadata<A>): MethodDecorator {
  return (_target, _propertyKey, descriptor: PropertyDescriptor) => {
    const original = descriptor.value as (...args: A) => Promise<unknown>;
    function wrapper(this: unknown, ...args: A) {
      const key = meta.key(...args);
      const withLock = getLockServiceRef().withLock as unknown as WithLockCallable;
      return withLock(key, meta.ttlMs, () => original.apply(this, args), {
        retry: meta.retry,
        autoRenew: meta.autoRenew,
        onTimeout: meta.onTimeout,
      });
    }
    // BẮT BUỘC: bảo toàn reflect-metadata Nest gắn lên hàm gốc (vd @Cron/@RabbitSubscribe).
    for (const k of Reflect.getMetadataKeys(original)) {
      Reflect.defineMetadata(k, Reflect.getMetadata(k, original), wrapper);
    }
    descriptor.value = wrapper;
    return descriptor;
  };
}
