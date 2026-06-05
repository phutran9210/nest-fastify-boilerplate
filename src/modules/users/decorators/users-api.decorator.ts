import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserResponseDto } from '../dto/user-response.dto';

// Swagger metadata cho UsersController — gom tap trung de controller chi giu logic route.

// Class-level: tag `users` + error envelope chuan + yeu cau bearer token cho moi route.
export function ApiUsersController() {
  return applyDecorators(ApiTags('users'), ApiStandardErrorResponses(), ApiBearerAuth());
}

// POST /users — tao user moi → 201 Created, envelope.
export function ApiCreateUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.CREATED }));
}

// GET /users — danh sach phan trang → 200 OK.
// Document data as UserResponseDto[]: ResponseInterceptor lifts `items` into `data`, so the
// documented shape matches the wire shape (PaginatedUsersResponseDto is the pre-lift shape).
export function ApiListUsers() {
  return applyDecorators(
    ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.OK, paginated: true }),
  );
}

// GET /users/:id → 200 OK, mot user trong envelope.
export function ApiFindUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.OK }));
}

// PATCH /users/:id → 200 OK, user sau cap nhat trong envelope.
export function ApiUpdateUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.OK }));
}

// DELETE /users/:id → 200 OK, user vua xoa trong envelope.
export function ApiRemoveUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.OK }));
}
