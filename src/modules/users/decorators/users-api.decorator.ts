import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { UserResponseDto } from '../dto/user-response.dto';

export function ApiUsersController() {
  return applyDecorators(ApiTags('users'), ApiStandardErrorResponses(), ApiBearerAuth());
}

export function ApiListUsers() {
  return applyDecorators(
    ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.OK, paginated: true }),
  );
}

export function ApiFindUser() {
  return applyDecorators(ApiEnvelopeResponse(UserResponseDto, { status: HttpStatus.OK }));
}
