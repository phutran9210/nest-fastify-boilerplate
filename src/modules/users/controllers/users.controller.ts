import { Controller, Get, HttpCode, HttpStatus, Param, Query } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { ApiFindUser, ApiListUsers, ApiUsersController } from '../decorators/users-api.decorator';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../services/users.service';

@ApiUsersController()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(PaginatedUsersResponseDto)
  @ApiListUsers()
  async findAll(@Query() query: ListUsersQueryDto) {
    const { items, total } = await this.users.findAll(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  @Get(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(UserResponseDto)
  @ApiFindUser()
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }
}
