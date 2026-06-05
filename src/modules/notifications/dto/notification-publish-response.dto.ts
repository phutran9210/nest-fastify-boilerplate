import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Shape tra ve cua POST /notifications/publish: { published: true } — xem notifications.controller.ts.
export const notificationPublishResponseSchema = z.object({
  published: z.boolean(),
});

export class NotificationPublishResponseDto extends (createZodDto(
  notificationPublishResponseSchema,
) as ReturnType<typeof createZodDto<typeof notificationPublishResponseSchema>>) {}
