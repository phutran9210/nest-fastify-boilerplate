import type { User } from '@generated/prisma/client';

export type { User };

export type FindUsersParams = { skip?: number; take?: number };

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findAll(params?: FindUsersParams): Promise<User[]>;
  abstract count(): Promise<number>;
}
