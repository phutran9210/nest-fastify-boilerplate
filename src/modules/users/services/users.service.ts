import { AppException } from '@common/exceptions/app.exception';
import { HttpStatus, Injectable } from '@nestjs/common';
import { type User, UserRepository } from '../repositories/user.repository.port';
import { UserMessage } from '../users.messages';

@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}

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

  async findOne(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new AppException(UserMessage.NOT_FOUND, HttpStatus.NOT_FOUND, { id });
    }
    return user;
  }
}
