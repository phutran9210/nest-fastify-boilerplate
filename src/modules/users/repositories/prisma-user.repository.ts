import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../core/prisma/prisma.service';
import type { User } from '../../../generated/prisma/client';
import { type CreateUserData, type UpdateUserData, UserRepository } from './user.repository';

@Injectable()
export class PrismaUserRepository extends UserRepository {
  constructor(private readonly prisma: PrismaService) {
    super();
  }
  findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }
  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }
  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }
  create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({ data });
  }
  update(id: string, data: UpdateUserData): Promise<User> {
    return this.prisma.user.update({ where: { id }, data });
  }
  delete(id: string): Promise<User> {
    return this.prisma.user.delete({ where: { id } });
  }
}
