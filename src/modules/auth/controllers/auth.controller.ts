import { Body, Controller, Get, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { ZodSerializerDto } from 'nestjs-zod';
import { type AuthUser, CurrentUser } from '../../../common/decorators/current-user.decorator';
import { Public } from '../../../common/decorators/public.decorator';
import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '../../../common/http/api-envelope.decorator';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { AuthService } from '../services/auth.service';

@ApiTags('auth')
@ApiStandardErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @ZodSerializerDto(UserResponseDto)
  @ApiEnvelopeResponse(UserResponseDto, { status: 201 })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @ApiOkResponse({ description: 'JWT access token' })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Get('me')
  @ApiOkResponse({ description: 'The current authenticated user' })
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
