import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  ApiCreateUser,
  ApiFindUser,
  ApiListUsers,
  ApiRemoveUser,
  ApiUpdateUser,
  ApiUsersController,
} from '../decorators/users-api.decorator';
import { CreateUserDto } from '../dto/create-user.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../services/users.service';

@ApiUsersController()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(UserResponseDto)
  @ApiCreateUser()
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

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

  @Patch(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(UserResponseDto)
  @ApiUpdateUser()
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ZodSerializerDto(UserResponseDto)
  @ApiRemoveUser()
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
