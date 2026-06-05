import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { MailTestResponseDto } from '../dto/mail-test-response.dto';

// Swagger metadata cho MailController — gom tap trung de controller chi giu logic route.

// Class-level: tag `mail` + error envelope chuan (route co validation body → 400/500).
export function ApiMailController() {
  return applyDecorators(ApiTags('mail'), ApiStandardErrorResponses());
}

// POST /mail/test — enqueue job bat dong bo → 202 Accepted, body trong envelope.
export function ApiMailTest() {
  return applyDecorators(ApiEnvelopeResponse(MailTestResponseDto, { status: HttpStatus.ACCEPTED }));
}
