import type { User } from '@generated/prisma/client';

// Re-export shape model qua port → service/test phụ thuộc PORT, không import generated/ trực tiếp.
export type { User };

export type CreateUserData = { email: string; password: string; name?: string | null };
export type UpdateUserData = Partial<CreateUserData>;
export type FindUsersParams = { skip?: number; take?: number };

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findByEmail(email: string): Promise<User | null>;
  abstract findAll(params?: FindUsersParams): Promise<User[]>;
  abstract create(data: CreateUserData): Promise<User>;
  abstract update(id: string, data: UpdateUserData): Promise<User>;
  abstract delete(id: string): Promise<User>;
  abstract count(): Promise<number>;
}
