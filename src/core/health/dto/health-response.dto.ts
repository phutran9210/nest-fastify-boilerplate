import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// Shape tra ve cua GET /health: { status: 'ok', timestamp } — timestamp la ISO string (Temporal).
export const healthResponseSchema = z.object({
  status: z.string(),
  timestamp: z.string(),
});

export class HealthResponseDto extends (createZodDto(healthResponseSchema) as ReturnType<
  typeof createZodDto<typeof healthResponseSchema>
>) {}
