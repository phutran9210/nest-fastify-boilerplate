import {
  ApiEnvelopeResponse,
  ApiStandardErrorResponses,
} from '@common/http/api-envelope.decorator';
import { applyDecorators, HttpStatus } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationPublishResponseDto } from '../dto/notification-publish-response.dto';

// Swagger metadata cho NotificationsController — gom tap trung de controller chi giu logic route.

// Class-level: tag `notifications` + error envelope chuan.
export function ApiNotificationsController() {
  return applyDecorators(ApiTags('notifications'), ApiStandardErrorResponses());
}

// POST /notifications/publish — publish event bat dong bo → 202 Accepted, body trong envelope.
export function ApiNotificationPublish() {
  return applyDecorators(
    ApiEnvelopeResponse(NotificationPublishResponseDto, { status: HttpStatus.ACCEPTED }),
  );
}
