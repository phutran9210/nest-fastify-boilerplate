import { AppException } from '@common/exceptions/app.exception';
import { HttpStatus, Injectable } from '@nestjs/common';
import {
  type CreateUserData,
  type UpdateUserData,
  type User,
  UserRepository,
} from '../repositories/user.repository.port';
import { UserMessage } from '../users.messages';

@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}

  create(data: CreateUserData): Promise<User> {
    return this.users.create(data);
  }

  async findAll(params: {
    page: number;
    limit: number;
  }): Promise<{ items: User[]; total: number }> {
    const { page, limit } = params;
    const [items, total] = await Promise.all([
      this.users.findAll({ skip: (page - 1) * limit, take: limit }),
      this.users.count(),
    ]);
    return { items, total };
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new AppException(UserMessage.NOT_FOUND, HttpStatus.NOT_FOUND, { id });
    }
    return user;
  }

  async update(id: string, data: UpdateUserData): Promise<User> {
    await this.findOne(id);
    return this.users.update(id, data);
  }

  async remove(id: string): Promise<User> {
    await this.findOne(id);
    return this.users.delete(id);
  }
}
