import { type AuthUser, CurrentUser } from '@common/decorators/current-user.decorator';
import { Public } from '@common/decorators/public.decorator';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { Body, Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ZodSerializerDto } from 'nestjs-zod';
import { ApiAuthController, ApiLogin, ApiMe, ApiRegister } from '../decorators/auth-api.decorator';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { AuthService } from '../services/auth.service';

@ApiAuthController()
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  @ZodSerializerDto(UserResponseDto)
  @ApiRegister()
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiLogin()
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiMe()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
