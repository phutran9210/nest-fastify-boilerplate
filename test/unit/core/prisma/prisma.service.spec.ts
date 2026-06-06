// Mock PrismaClient before importing PrismaService to avoid ESM/native-binding issues.
jest.mock('@generated/prisma/client', () => ({
  PrismaClient: class PrismaClient {
    $connect() {}
    $disconnect() {}
    $transaction(fn: (tx: unknown) => Promise<unknown>) {
      return fn({});
    }
  },
}));

import { PrismaService } from '@core/prisma/prisma.service';

describe('PrismaService transaction context', () => {
  // Tạo mới mỗi test (tránh state rò rỉ khi 1 test monkey-patch $transaction).
  // Object.create để KHÔNG gọi super connect → test logic ALS thuần.
  let svc: PrismaService;
  beforeEach(() => {
    svc = Object.create(PrismaService.prototype) as PrismaService;
  });

  it('db trả base client khi ngoài transaction', () => {
    expect(svc.db).toBe(svc);
  });

  it('db trả tx client khi trong runInTransaction', async () => {
    const fakeTx = { marker: 'tx' } as unknown;
    // Giả lập $transaction gọi callback với fakeTx.
    (svc as any).$transaction = (fn: (tx: unknown) => Promise<unknown>) => fn(fakeTx);
    const seen = await svc.runInTransaction(async () => svc.db);
    expect(seen).toBe(fakeTx);
    // Ngoài transaction lại trả base.
    expect(svc.db).toBe(svc);
  });
});
