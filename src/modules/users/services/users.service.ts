import { Injectable, NotFoundException } from '@nestjs/common';
import {
  type CreateUserData,
  type UpdateUserData,
  type User,
  UserRepository,
} from '../repositories/user.repository';

@Injectable()
export class UsersService {
  constructor(private readonly users: UserRepository) {}

  create(data: CreateUserData): Promise<User> {
    return this.users.create(data);
  }

  findAll(): Promise<User[]> {
    return this.users.findAll();
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.findByEmail(email);
  }

  async findOne(id: string): Promise<User> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`User ${id} not found`);
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
