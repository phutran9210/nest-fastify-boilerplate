import { PrismaService } from '@core/prisma/prisma.service';
import type { User } from '@generated/prisma/client';
import { Injectable } from '@nestjs/common';
import { type FindUsersParams, UserRepository } from './user.repository.port';

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  findById(id: string): Promise<User | null> {
    return this.prisma.db.user.findUnique({ where: { id } });
  }

  findAll(params?: FindUsersParams): Promise<User[]> {
    return this.prisma.db.user.findMany({ skip: params?.skip, take: params?.take });
  }

  count(): Promise<number> {
    return this.prisma.db.user.count();
  }
}
