import { Module } from '@nestjs/common';
import { UsersController } from './controllers/users.controller';
import { UserRepository } from './repositories/user.repository.port';
import { PrismaUserRepository } from './repositories/user.repository.prisma';
import { UsersService } from './services/users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService, { provide: UserRepository, useClass: PrismaUserRepository }],
  exports: [UsersService],
})
export class UsersModule {}
