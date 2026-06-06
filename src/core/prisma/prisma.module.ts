import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { TransactionManager } from './transaction-manager.port';
import { PrismaTransactionManager } from './transaction-manager.prisma';

@Global()
@Module({
  providers: [PrismaService, { provide: TransactionManager, useClass: PrismaTransactionManager }],
  exports: [PrismaService, TransactionManager],
})
export class PrismaModule {}
