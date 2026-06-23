import { type AuthUser, CurrentUser } from '@common/decorators/current-user.decorator';
import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiAuthController, ApiMe } from '../decorators/auth-api.decorator';

@ApiAuthController()
@Controller('auth')
export class AuthController {
  @Get('me')
  @HttpCode(HttpStatus.OK)
  @ApiMe()
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
