export interface LockOptions {
  retry?: { waitMs: number; minDelayMs?: number; maxDelayMs?: number };
  autoRenew?: boolean;
  fencing?: boolean;
  onTimeout?: 'throw' | 'return';
}

export interface Lock {
  key: string;
  token: string;
  fencingToken: number | null; // số khi opts.fencing=true; null nếu không yêu cầu fencing
  signal: AbortSignal; // abort khi watchdog phát hiện mất lock (autoRenew)
  release(): Promise<boolean>;
  extend(ttlMs: number): Promise<boolean>;
}

export abstract class LockService {
  abstract acquire(key: string, ttlMs: number, opts?: LockOptions): Promise<Lock | null>;

  abstract withLock<T>(
    key: string,
    ttlMs: number,
    fn: (lock: Lock) => Promise<T>,
    opts?: Omit<LockOptions, 'onTimeout'> & { onTimeout?: 'throw' },
  ): Promise<T>;
  abstract withLock<T>(
    key: string,
    ttlMs: number,
    fn: (lock: Lock) => Promise<T>,
    opts: Omit<LockOptions, 'onTimeout'> & { onTimeout: 'return' },
  ): Promise<T | undefined>;
}
