import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { CreateUserDto } from '../dto/create-user.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ZodSerializerDto(UserResponseDto)
  @ApiCreatedResponse({ type: UserResponseDto })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  @ZodSerializerDto(UserResponseDto)
  @ApiOkResponse({ type: [UserResponseDto] })
  findAll(@Query() query: ListUsersQueryDto) {
    return this.users.findAll(query);
  }

  @Get(':id')
  @ZodSerializerDto(UserResponseDto)
  @ApiOkResponse({ type: UserResponseDto })
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @ZodSerializerDto(UserResponseDto)
  @ApiOkResponse({ type: UserResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @ZodSerializerDto(UserResponseDto)
  @ApiOkResponse({ type: UserResponseDto })
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
