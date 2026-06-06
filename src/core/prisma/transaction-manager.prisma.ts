import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionManager, type TransactionOptions } from './transaction-manager.port';

@Injectable()
export class PrismaTransactionManager extends TransactionManager {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  run<T>(fn: () => Promise<T>, options?: TransactionOptions): Promise<T> {
    return this.prisma.runInTransaction(fn, options);
  }
}
