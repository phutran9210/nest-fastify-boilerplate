import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '../../../common/http/api-envelope.decorator';
import { CreateUserDto } from '../dto/create-user.dto';
import { ListUsersQueryDto } from '../dto/list-users-query.dto';
import { PaginatedUsersResponseDto } from '../dto/paginated-users-response.dto';
import { UpdateUserDto } from '../dto/update-user.dto';
import { UserResponseDto } from '../dto/user-response.dto';
import { UsersService } from '../services/users.service';

@ApiTags('users')
@ApiStandardErrorResponses()
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Post()
  @ZodSerializerDto(UserResponseDto)
  @ApiEnvelopeResponse(UserResponseDto, { status: 201 })
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Get()
  @ZodSerializerDto(PaginatedUsersResponseDto)
  // Document data as UserResponseDto[]: ResponseInterceptor lifts `items` into `data`, so the
  // documented shape matches the wire shape (PaginatedUsersResponseDto is the pre-lift shape).
  @ApiEnvelopeResponse(UserResponseDto, { paginated: true })
  async findAll(@Query() query: ListUsersQueryDto) {
    const { items, total } = await this.users.findAll(query);
    return { items, total, page: query.page, limit: query.limit };
  }

  @Get(':id')
  @ZodSerializerDto(UserResponseDto)
  @ApiEnvelopeResponse(UserResponseDto)
  findOne(@Param('id') id: string) {
    return this.users.findOne(id);
  }

  @Patch(':id')
  @ZodSerializerDto(UserResponseDto)
  @ApiEnvelopeResponse(UserResponseDto)
  update(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(id, dto);
  }

  @Delete(':id')
  @ZodSerializerDto(UserResponseDto)
  @ApiEnvelopeResponse(UserResponseDto)
  remove(@Param('id') id: string) {
    return this.users.remove(id);
  }
}
