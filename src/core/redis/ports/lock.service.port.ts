export interface Lock {
  key: string;
  token: string; // giá trị random nhận diện chủ lock (dùng khi release)
  fencingToken: number; // counter tăng dần — caller so cũ/mới để chặn ghi đè
  release(): Promise<boolean>;
}

export abstract class LockService {
  abstract acquire(key: string, ttlMs: number): Promise<Lock | null>;
  abstract withLock<T>(key: string, ttlMs: number, fn: (lock: Lock) => Promise<T>): Promise<T>;
}
