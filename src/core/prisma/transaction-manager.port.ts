// Tùy chọn cho interactive transaction (khớp Prisma $transaction): timeout dài hơn mặc định
// 5s cho tác vụ nhiều bước như outbox relay (claim + nhiều publish + mark trong 1 transaction).
export type TransactionOptions = { maxWait?: number; timeout?: number };

// PORT — abstract class vừa là type vừa là DI token. Service nghiệp vụ inject cái này,
// KHÔNG inject PrismaService trực tiếp (giữ nguyên quy ước repo port).
export abstract class TransactionManager {
  abstract run<T>(fn: () => Promise<T>, options?: TransactionOptions): Promise<T>;
}
