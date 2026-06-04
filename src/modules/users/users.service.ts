import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../core/prisma/prisma.service';
import type { Prisma, User } from '../../generated/prisma/client';

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.UserCreateInput): Promise<User> {
    return this.prisma.user.create({ data });
  }

  findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findOne(id: string): Promise<User> {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
    }
    return user;
  }

  async update(id: string, data: Prisma.UserUpdateInput): Promise<User> {
    await this.findOne(id);
    return this.prisma.user.update({ where: { id }, data });
  }

  async remove(id: string): Promise<User> {
    await this.findOne(id);
    return this.prisma.user.delete({ where: { id } });
  }
}
