import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { UserResponseDto } from '@modules/users/dto/user-response.dto';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUserResponseDto } from '../dto/auth-user-response.dto';
import { LoginResponseDto } from '../dto/login-response.dto';

// Swagger metadata cho AuthController — gom tap trung de controller chi giu logic route.

// Class-level: gan tag `auth` + tai lieu hoa cac error envelope chuan.
export function ApiAuthController() {
  return applyDecorators(ApiTags('auth'), ApiStandardErrorResponses());
}

// POST /auth/register — tao user moi → 201 Created, envelope.
export function ApiRegister() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.CREATED }));
}

// POST /auth/login — xac thuc (khong tao resource) → 200 OK, token envelope.
export function ApiLogin() {
  return applyDecorators(ApiEnvelopeResponse(LoginResponseDto, { status: HttpStatus.OK }));
}

// GET /auth/me — yeu cau bearer token → 200 OK, user hien tai trong envelope.
export function ApiMe() {
  return applyDecorators(
    ApiBearerAuth(),
    ApiEnvelopeResponse(AuthUserResponseDto, { status: HttpStatus.OK }),
  );
}
