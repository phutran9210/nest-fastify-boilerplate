import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUserResponseDto } from '../dto/auth-user-response.dto';

export function ApiAuthController() {
  return applyDecorators(ApiTags('auth'), ApiStandardErrorResponses(), ApiBearerAuth());
}

// GET /auth/me — requires a session (cookie or bearer) → 200 OK, current user in envelope.
export function ApiMe() {
  return applyDecorators(ApiEnvelopeResponse(AuthUserResponseDto, { status: HttpStatus.OK }));
}
