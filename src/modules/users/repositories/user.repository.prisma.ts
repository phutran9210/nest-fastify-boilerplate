// ADAPTER — implement PORT bằng Prisma. File DUY NHẤT trong module được import PrismaService + generated/.
import { PrismaService } from '@core/prisma/prisma.service';
import { Prisma, type User } from '@generated/prisma/client';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type CreateUserData,
  type FindUsersParams,
  type UpdateUserData,
  UserRepository,
} from './user.repository.port';

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

  findAll(params?: FindUsersParams): Promise<User[]> {
    return this.prisma.user.findMany({ skip: params?.skip, take: params?.take });
  }

  count(): Promise<number> {
    return this.prisma.user.count();
  }

  async create(data: CreateUserData): Promise<User> {
    try {
      return await this.prisma.user.create({ data });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    try {
      return await this.prisma.user.update({ where: { id }, data });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  async delete(id: string): Promise<User> {
    try {
      return await this.prisma.user.delete({ where: { id } });
    } catch (e) {
      throw this.mapError(e);
    }
  }

  // Centralised translation so every write maps Prisma's known request errors to the same
  // NestJS HTTP exceptions: P2002 unique constraint, P2025 record not found, P2003 FK.
  private mapError(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      switch (e.code) {
        case 'P2002':
          return new ConflictException('A user with this email already exists');
        case 'P2025':
          return new NotFoundException('User not found');
        case 'P2003':
          return new BadRequestException('Invalid reference');
      }
    }
    return e;
  }
}
