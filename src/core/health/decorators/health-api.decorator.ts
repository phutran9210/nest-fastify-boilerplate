import { ApiEnvelopeResponse } from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthResponseDto } from '../dto/health-response.dto';

// Swagger metadata cho HealthController — gom tap trung de controller chi giu logic route.

// Class-level: tag `health`. Khong gan ApiStandardErrorResponses — liveness check khong co error path.
export function ApiHealthController() {
  return applyDecorators(ApiTags('health'));
}

// GET /health → 200 OK, { status, timestamp } trong envelope.
export function ApiHealthCheck() {
  return applyDecorators(ApiEnvelopeResponse(HealthResponseDto, { status: HttpStatus.OK }));
}
